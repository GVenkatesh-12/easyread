import { streamSpeech, type StreamAudioChunk } from './api';

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

const DEFAULT_CHUNK_SIZE = 4000;
const WORD_SPLIT_THRESHOLD = 12;
const DEFAULT_SAMPLE_RATE = 24000;

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

/* ── Streaming audio pipeline ────────────────────────────────── */

/** Growable Float32 sample buffer that avoids per-delta reallocations. */
class SampleBuffer {
    private data = new Float32Array(4096);
    private len = 0;

    append(samples: Float32Array) {
        if (this.len + samples.length > this.data.length) {
            let capacity = this.data.length * 2;
            while (capacity < this.len + samples.length) capacity *= 2;
            const next = new Float32Array(capacity);
            next.set(this.data.subarray(0, this.len));
            this.data = next;
        }
        this.data.set(samples, this.len);
        this.len += samples.length;
    }

    toFloat32Array(): Float32Array<ArrayBuffer> {
        return this.len === this.data.length ? this.data : this.data.subarray(0, this.len);
    }

    get length() {
        return this.len;
    }
}

/** Decode a raw 16-bit little-endian PCM delta (audio/l16 or audio/pcm). */
function decodePcmDelta(chunk: StreamAudioChunk): { channelData: Float32Array[]; channels: number; sampleRate: number } {
    const bytes = base64ToUint8Array(chunk.data);
    const channels = Math.max(1, Math.floor(chunk.channels) || 1);
    const sampleRate = chunk.sampleRate || DEFAULT_SAMPLE_RATE;
    const totalSamples = Math.floor(bytes.byteLength / 2);
    const perChannel = Math.floor(totalSamples / channels);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channelData: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
        const out = new Float32Array(perChannel);
        for (let j = 0; j < perChannel; j++) {
            out[j] = view.getInt16((j * channels + c) * 2, true) / 32768;
        }
        channelData.push(out);
    }
    return { channelData, channels, sampleRate };
}

interface PendingChunk {
    text: string;
    offset: number;
    channelData: SampleBuffer[];
    sampleRate: number;
    channels: number;
    done: boolean;
}

interface PlayableChunk {
    buffer: AudioBuffer | null;
    text: string;
    offset: number;
}

interface ActiveSource {
    source: AudioBufferSourceNode;
    buffer: AudioBuffer;
    text: string;
    offset: number;
    startTime: number;
}

export class TtsController {
    private audioContext: AudioContext | null = null;
    private abortController: AbortController | null = null;
    private chunks: TextChunk[] = [];
    private pendingChunks: PendingChunk[] = [];
    private readyQueue: PlayableChunk[] = [];
    private playing: ActiveSource | null = null;
    private aborted = false;
    private sessionId = 0;
    private charSpanMap: CharSpanMap | null = null;
    private appliedSpans: Set<HTMLElement> = new Set();
    private rafId: number | null = null;
    private callbacks: TtsControllerCallbacks = {};
    private status: TtsStatus = 'idle';
    private label = '';
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

        let ctx: AudioContext;
        try {
            ctx = new AudioContext();
        } catch {
            this.emitError('Audio playback is not supported in this browser.');
            return;
        }
        void ctx.resume().catch(() => {});

        this.audioContext = ctx;
        this.chunks = chunks;
        this.pendingChunks = chunks.map((chunk) => ({
            text: chunk.text,
            offset: chunk.offset,
            channelData: [],
            sampleRate: DEFAULT_SAMPLE_RATE,
            channels: 1,
            done: false,
        }));
        this.readyQueue = [];
        this.aborted = false;
        this.sessionId++;
        this.abortController = new AbortController();

        this.setStatus('loading', label);
        void this.streamChunk(0);
    }

    pause() {
        if (this.status !== 'playing') return;
        void this.audioContext?.suspend();
        this.stopHighlightLoop();
        this.setStatus('paused', this.label);
    }

    resume() {
        if (this.status !== 'paused') return;
        void this.audioContext?.resume();
        if (this.playing) {
            this.startHighlightLoop();
            this.setStatus('playing', this.label);
        } else {
            this.setStatus('loading', this.label);
            this.playNext();
        }
    }

    stop() {
        this.stopInternal();
        this.setStatus('idle', '');
    }

    dispose() {
        this.stopInternal();
        this.callbacks = {};
    }

    /** Stream one chunk from the server, then pipeline the next chunk's stream. */
    private async streamChunk(index: number) {
        const chunk = this.chunks[index];
        const signal = this.abortController?.signal;
        const session = this.sessionId;
        try {
            await streamSpeech(
                chunk.text,
                {
                    onAudio: async (audio) => {
                        if (this.aborted || session !== this.sessionId) return;
                        await this.appendAudio(index, audio);
                    },
                },
                signal,
            );

            if (this.aborted || session !== this.sessionId) return;
            this.finalizeChunk(index);

            if (index + 1 < this.chunks.length) {
                void this.streamChunk(index + 1);
            } else if (!this.playing && this.readyQueue.length === 0) {
                this.finishPlayback();
            }
        } catch (err) {
            if (this.aborted || session !== this.sessionId || signal?.aborted) return;
            this.emitError(err instanceof Error ? err.message : 'Failed to generate speech.');
            this.stopInternal();
            this.setStatus('idle', '');
        }
    }

    private async appendAudio(index: number, chunk: StreamAudioChunk) {
        const pending = this.pendingChunks[index];
        const ctx = this.audioContext;
        if (!pending || !ctx) return;

        let decoded: { channelData: Float32Array[]; channels: number; sampleRate: number };
        try {
            decoded = await this.decodeDelta(chunk, ctx);
        } catch (err) {
            // If nothing has played for this chunk yet, surface the failure.
            if (pending.channelData.length === 0) throw err;
            console.error('TTS audio decode error:', err);
            return;
        }

        pending.channels = decoded.channels;
        pending.sampleRate = decoded.sampleRate;
        for (let c = 0; c < decoded.channelData.length; c++) {
            if (!pending.channelData[c]) pending.channelData[c] = new SampleBuffer();
            pending.channelData[c].append(decoded.channelData[c]);
        }
    }

    private async decodeDelta(
        chunk: StreamAudioChunk,
        ctx: AudioContext,
    ): Promise<{ channelData: Float32Array[]; channels: number; sampleRate: number }> {
        const mime = chunk.mimeType || 'audio/l16';
        if (mime === 'audio/l16' || mime === 'audio/pcm') {
            return decodePcmDelta(chunk);
        }
        // WAV/MP3/OGG deltas: decode via Web Audio.
        const bytes = base64ToUint8Array(chunk.data);
        const buffer = await ctx.decodeAudioData(bytes.buffer);
        const channelData: Float32Array[] = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            channelData.push(buffer.getChannelData(c).slice());
        }
        return { channelData, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate };
    }

    private finalizeChunk(index: number) {
        const pending = this.pendingChunks[index];
        if (!pending || pending.done) return;
        pending.done = true;

        const length = pending.channelData[0]?.length ?? 0;
        const ctx = this.audioContext;
        if (ctx && length > 0) {
            const buffer = new AudioBuffer({
                numberOfChannels: Math.min(pending.channels, pending.channelData.length),
                length,
                sampleRate: pending.sampleRate,
            });
            for (let c = 0; c < buffer.numberOfChannels; c++) {
                buffer.copyToChannel(pending.channelData[c].toFloat32Array(), c);
            }
            this.readyQueue.push({ buffer, text: pending.text, offset: pending.offset });
        }
        this.playNext();
    }

    private playNext() {
        if (this.playing || this.status === 'paused') return;
        const ctx = this.audioContext;
        if (!ctx) return;

        while (this.readyQueue.length > 0) {
            const item = this.readyQueue.shift();
            if (!item || !item.buffer) continue;

            const source = ctx.createBufferSource();
            source.buffer = item.buffer;
            source.connect(ctx.destination);

            this.playing = {
                source,
                buffer: item.buffer,
                text: item.text,
                offset: item.offset,
                startTime: ctx.currentTime,
            };

            source.onended = () => {
                if (this.playing?.source !== source) return;
                this.playing = null;
                if (this.status === 'paused') return;
                if (this.readyQueue.length > 0) {
                    this.playNext();
                } else if (this.pendingChunks.every((pending) => pending.done)) {
                    this.finishPlayback();
                } else {
                    this.setStatus('loading', this.label);
                }
            };

            source.start();
            this.setStatus('playing', this.label);
            this.startHighlightLoop();
            return;
        }
    }

    private finishPlayback() {
        this.stopInternal();
        this.setStatus('idle', '');
    }

    private stopInternal() {
        this.aborted = true;
        this.abortController?.abort();
        this.abortController = null;

        if (this.playing?.source) {
            this.playing.source.onended = null;
            try {
                this.playing.source.stop();
            } catch {
                // Source may already have stopped.
            }
            this.playing.source.disconnect();
        }
        this.playing = null;
        this.readyQueue = [];
        this.pendingChunks = [];
        this.chunks = [];
        this.stopHighlightLoop();
        this.clearHighlight();

        const ctx = this.audioContext;
        this.audioContext = null;
        if (ctx && ctx.state !== 'closed') {
            void ctx.close().catch(() => {});
        }
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
            if (!this.playing) return;
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
        const ctx = this.audioContext;
        const current = this.playing;
        if (!ctx || !current || !this.charSpanMap) return;

        const elapsed = ctx.currentTime - current.startTime;
        const duration = current.buffer.duration;
        const fraction = duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : 0;
        const textIndex = Math.min(current.text.length - 1, Math.floor(fraction * current.text.length));

        const wordStart = this.baseOffset + current.offset + expandWordStart(current.text, textIndex);
        const wordEnd = this.baseOffset + current.offset + expandWordEnd(current.text, textIndex);
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
