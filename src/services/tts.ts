import { synthesizeSpeech, type TtsAlignment } from './api';

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface CharSpan {
    span: HTMLElement;
    node: Text;
    start: number;
    end: number;
}

export interface CharSpanMap {
    root: HTMLElement;
    spans: CharSpan[];
    text: string;
}

export interface TextChunk {
    text: string;
    offset: number;
}

export interface TtsControllerCallbacks {
    onStatusChange?: (status: TtsStatus, label: string) => void;
    onError?: (message: string) => void;
}

interface LoadedChunk {
    text: string;
    offset: number;
    audioUrl: string;
    alignment: TtsAlignment | null;
    alignmentMap: number[] | null;
}

const DEFAULT_CHUNK_SIZE = 4000;
const ALIGNMENT_RESYNC_WINDOW = 24;
const WORD_SPLIT_THRESHOLD = 12;

const isWhitespace = (c: string) => /\s/.test(c);

export function chunkText(text: string, maxChars = DEFAULT_CHUNK_SIZE): TextChunk[] {
    const chunks: TextChunk[] = [];
    const length = text.length;
    let start = 0;

    while (start < length) {
        if (length - start <= maxChars) {
            chunks.push({ text: text.slice(start), offset: start });
            break;
        }

        const end = start + maxChars;
        let cut = -1;

        for (let i = end - 1; i > start; i--) {
            const char = text[i];
            const next = text[i + 1] ?? '';
            if ('.!?;:'.includes(char) && isWhitespace(next)) {
                cut = i + 1;
                break;
            }
        }

        if (cut === -1) {
            for (let i = end - 1; i > start; i--) {
                if (isWhitespace(text[i])) {
                    cut = i + 1;
                    break;
                }
            }
        }

        if (cut === -1) cut = end;
        chunks.push({ text: text.slice(start, cut), offset: start });
        start = cut;
    }

    return chunks;
}

function isSkippedElement(el: Element, root: Element): boolean {
    if (el === root) return false;
    if (el.hasAttribute('role') && el.getAttribute('role') === 'img') return true;
    if (el.classList.contains('endOfContent')) return true;
    return false;
}

function splitTextNodeIntoWords(node: Text) {
    const value = node.nodeValue ?? '';
    const tokens = value.match(/[^\s]+|\s+/g) ?? [];
    const fragment = document.createDocumentFragment();
    for (const token of tokens) {
        if (/^\s+$/.test(token)) {
            fragment.appendChild(document.createTextNode(token));
        } else {
            const word = document.createElement('span');
            word.className = 'tts-word';
            word.textContent = token;
            fragment.appendChild(word);
        }
    }
    node.replaceWith(fragment);
}

export function buildCharSpanMap(textLayer: HTMLElement): CharSpanMap {
    const splitWalker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    let splitNode: Node | null;
    while ((splitNode = splitWalker.nextNode())) {
        const parent = splitNode.parentElement;
        if (!parent || isSkippedElement(parent, textLayer)) continue;
        const value = splitNode.nodeValue ?? '';
        if (value.length > WORD_SPLIT_THRESHOLD) {
            splitTextNodeIntoWords(splitNode as Text);
        }
    }

    const spans: CharSpan[] = [];
    const pieces: string[] = [];
    let offset = 0;

    const handleTextNode = (node: Text) => {
        const value = node.nodeValue ?? '';
        if (value.length === 0) return;
        if (value.trim().length === 0) {
            pieces.push(value);
            offset += value.length;
            return;
        }
        const span = node.parentElement;
        if (!span) return;
        spans.push({ span, node, start: offset, end: offset + value.length });
        pieces.push(value);
        offset += value.length;
    };

    const walk = (element: Element) => {
        for (const child of Array.from(element.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
                handleTextNode(child as Text);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const childEl = child as Element;
                if (childEl.tagName === 'BR') {
                    pieces.push('\n');
                    offset += 1;
                } else if (!isSkippedElement(childEl, textLayer)) {
                    walk(childEl);
                }
            }
        }
    };

    walk(textLayer);
    return { root: textLayer, spans, text: pieces.join('') };
}

export function rangeToTextWithOffsets(range: Range, map: CharSpanMap): { text: string; start: number; end: number } | null {
    const resolveBoundary = (container: Node, isStart: boolean): number | null => {
        if (container.nodeType === Node.TEXT_NODE) {
            const text = container as Text;
            const offset = isStart ? range.startOffset : range.endOffset;
            for (const entry of map.spans) {
                if (entry.node === text) return entry.start + offset;
            }
            return null;
        }
        if (container.nodeType === Node.ELEMENT_NODE) {
            if (container === map.root) {
                return isStart ? 0 : map.text.length;
            }
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let node: Node | null = null;
            while ((node = walker.nextNode())) {
                for (const entry of map.spans) {
                    if (entry.node === node) return isStart ? entry.start : entry.end;
                }
            }
        }
        return null;
    };

    const start = resolveBoundary(range.startContainer, true);
    const end = resolveBoundary(range.endContainer, false);
    if (start === null || end === null || end <= start) return null;
    return { text: map.text.slice(start, end), start, end };
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function buildAlignmentMap(alignChars: string[], text: string): number[] {
    const map = new Array<number>(alignChars.length);
    let p = 0;

    for (let q = 0; q < alignChars.length; q++) {
        const ac = alignChars[q];
        if (p >= text.length) {
            map[q] = text.length - 1;
            continue;
        }

        if (ac === text[p] || (isWhitespace(ac) && isWhitespace(text[p]))) {
            map[q] = p;
            p++;
            continue;
        }

        let found = -1;
        const limit = Math.min(p + ALIGNMENT_RESYNC_WINDOW, text.length - 1);
        for (let s = 1; p + s <= limit; s++) {
            const tc = text[p + s];
            if (ac === tc || (isWhitespace(ac) && isWhitespace(tc))) {
                found = p + s;
                break;
            }
        }

        if (found !== -1) {
            p = found;
            map[q] = p;
            p++;
        } else {
            map[q] = p;
        }
    }

    return map;
}

function expandWordStart(text: string, idx: number): number {
    let s = Math.max(0, Math.min(idx, text.length - 1));
    while (s > 0 && !isWhitespace(text[s - 1])) s--;
    return s;
}

function expandWordEnd(text: string, idx: number): number {
    let e = Math.max(0, Math.min(idx, text.length - 1));
    while (e < text.length && !isWhitespace(text[e])) e++;
    return e;
}

export class TtsController {
    private audio: HTMLAudioElement | null = null;
    private abortController: AbortController | null = null;
    private chunks: (LoadedChunk | undefined)[] = [];
    private nextPlayIndex = 0;
    private playingIndex: number | null = null;
    private totalChunks = 0;
    private aborted = false;
    private sessionId = 0;
    private charSpanMap: CharSpanMap | null = null;
    private appliedSpans: Set<HTMLElement> = new Set();
    private rafId: number | null = null;
    private callbacks: TtsControllerCallbacks = {};
    private status: TtsStatus = 'idle';
    private label = '';
    private currentChunk: LoadedChunk | null = null;
    private baseOffset = 0;
    private highlightEnabled = true;

    constructor(callbacks?: TtsControllerCallbacks) {
        this.callbacks = callbacks ?? {};
    }

    getStatus(): TtsStatus {
        return this.status;
    }

    isActive(): boolean {
        return this.status !== 'idle';
    }

    setCharSpanMap(map: CharSpanMap | null) {
        this.charSpanMap = map;
        if (!map) this.clearHighlight();
    }

    play(text: string, label: string, options?: { baseOffset?: number; highlight?: boolean }) {
        this.stopInternal();
        this.label = label;
        this.baseOffset = options?.baseOffset ?? 0;
        this.highlightEnabled = options?.highlight ?? true;
        const chunks = chunkText(text);
        if (chunks.length === 0) {
            this.emitError('No readable text found to speak.');
            return;
        }

        this.totalChunks = chunks.length;
        this.chunks = new Array(chunks.length);
        this.nextPlayIndex = 0;
        this.aborted = false;
        this.sessionId++;
        this.abortController = new AbortController();
        this.setStatus('loading', label);

        for (let i = 0; i < chunks.length; i++) {
            void this.fetchChunk(chunks[i], i);
        }
    }

    pause() {
        if (this.status !== 'playing') return;
        this.audio?.pause();
        this.stopHighlightLoop();
        this.setStatus('paused', this.label);
    }

    resume() {
        if (this.status !== 'paused') return;
        if (this.audio) {
            void this.audio
                .play()
                .then(() => this.setStatus('playing', this.label))
                .catch(() => {});
            this.startHighlightLoop();
            return;
        }
        this.setStatus('loading', this.label);
        this.maybePlayNext();
    }

    stop() {
        this.stopInternal();
        this.setStatus('idle', '');
    }

    dispose() {
        this.stopInternal();
        this.callbacks = {};
    }

    private async fetchChunk(chunk: TextChunk, index: number) {
        const signal = this.abortController?.signal;
        const session = this.sessionId;
        try {
            const result = await synthesizeSpeech(chunk.text, signal);
            if (this.aborted || session !== this.sessionId) return;

            const audioUrl = URL.createObjectURL(
                new Blob([base64ToUint8Array(result.audioBase64)], { type: 'audio/mpeg' }),
            );

            const loaded: LoadedChunk = {
                text: chunk.text,
                offset: chunk.offset,
                audioUrl,
                alignment: result.alignment,
                alignmentMap: result.alignment
                    ? buildAlignmentMap(result.alignment.characters, chunk.text)
                    : null,
            };
            this.chunks[index] = loaded;
            this.maybePlayNext();
        } catch (err) {
            if (this.aborted || session !== this.sessionId || signal?.aborted) return;
            this.emitError(err instanceof Error ? err.message : 'Failed to generate speech.');
            this.stopInternal();
        }
    }

    private maybePlayNext() {
        if (this.playingIndex !== null) return;
        if (this.nextPlayIndex >= this.totalChunks) return;
        const chunk = this.chunks[this.nextPlayIndex];
        if (!chunk) return;
        this.playChunk(chunk, this.nextPlayIndex);
    }

    private playChunk(chunk: LoadedChunk, index: number) {
        this.playingIndex = index;
        this.currentChunk = chunk;

        const audio = new Audio(chunk.audioUrl);
        this.audio = audio;
        audio.onended = () => {
            if (this.playingIndex !== index) return;
            this.playingIndex = null;
            this.currentChunk = null;
            this.nextPlayIndex = index + 1;

            if (this.nextPlayIndex >= this.totalChunks) {
                this.stopInternal();
                this.setStatus('idle', '');
                return;
            }
            if (this.status === 'paused') return;
            this.setStatus('loading', this.label);
            this.maybePlayNext();
        };

        this.startHighlightLoop();
        void audio
            .play()
            .then(() => {
                if (this.playingIndex === index) this.setStatus('playing', this.label);
            })
            .catch(() => {});
    }

    private stopInternal() {
        this.aborted = true;
        this.abortController?.abort();
        this.abortController = null;
        this.audio?.pause();
        if (this.audio) {
            this.audio.removeAttribute('src');
            this.audio.load();
        }
        this.audio = null;
        this.stopHighlightLoop();
        for (const chunk of this.chunks) {
            if (chunk) URL.revokeObjectURL(chunk.audioUrl);
        }
        this.chunks = [];
        this.totalChunks = 0;
        this.nextPlayIndex = 0;
        this.playingIndex = null;
        this.currentChunk = null;
        this.clearHighlight();
    }

    private setStatus(status: TtsStatus, label: string) {
        if (this.status === status && this.label === label) return;
        this.status = status;
        this.label = label;
        this.callbacks.onStatusChange?.(status, label);
    }

    private emitError(message: string) {
        this.callbacks.onError?.(message);
    }

    private startHighlightLoop() {
        this.stopHighlightLoop();
        const tick = () => {
            if (!this.audio || !this.currentChunk) return;
            this.updateHighlight();
            this.rafId = requestAnimationFrame(tick);
        };
        this.rafId = requestAnimationFrame(tick);
    }

    private stopHighlightLoop() {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    private updateHighlight() {
        if (!this.highlightEnabled) return;
        const audio = this.audio;
        const chunk = this.currentChunk;
        if (!audio || !chunk || !this.charSpanMap) return;

        const time = audio.currentTime;
        let textIndex: number;

        if (chunk.alignment && chunk.alignment.character_start_times_seconds.length > 0 && chunk.alignmentMap) {
            const starts = chunk.alignment.character_start_times_seconds;
            let lo = 0;
            let hi = starts.length - 1;
            let q = 0;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (starts[mid] <= time) {
                    q = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            textIndex = chunk.alignmentMap[q] ?? 0;
        } else {
            const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1;
            const fraction = Math.min(1, time / duration);
            textIndex = Math.min(chunk.text.length - 1, Math.floor(fraction * chunk.text.length));
        }

        const wordStart = this.baseOffset + chunk.offset + expandWordStart(chunk.text, textIndex);
        const wordEnd = this.baseOffset + chunk.offset + expandWordEnd(chunk.text, textIndex);
        this.applyHighlight(wordStart, wordEnd);
    }

    private applyHighlight(start: number, end: number) {
        const map = this.charSpanMap;
        if (!map) return;

        const next: Set<HTMLElement> = new Set();
        for (const entry of map.spans) {
            if (entry.start < end && entry.end > start) {
                next.add(entry.span);
            }
        }

        for (const span of this.appliedSpans) {
            if (!next.has(span)) span.classList.remove('tts-active');
        }
        for (const span of next) {
            if (!this.appliedSpans.has(span)) span.classList.add('tts-active');
        }
        this.appliedSpans = next;
    }

    private clearHighlight() {
        for (const span of this.appliedSpans) {
            span.classList.remove('tts-active');
        }
        this.appliedSpans.clear();
    }
}
