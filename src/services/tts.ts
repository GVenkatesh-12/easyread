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

// Chunks keep per-request latency low and stay well inside the TTS
// provider's quality envelope; 1500 chars is ~1.5-2 min of speech.
const DEFAULT_CHUNK_SIZE = 1500;
const WORD_SPLIT_THRESHOLD = 12;
const DEFAULT_SAMPLE_RATE = 24000;
/** Seconds of audio to accumulate before handing a playable segment to the queue. */
const SEGMENT_TARGET_SECONDS = 1.0;
/** Buffer this much audio before starting playback, so generation jitter never stutters. */
const PLAY_START_PREROLL_SECONDS = 5;
/** When the playing chunk's buffer drops below this, start the next chunk's stream early. */
const EARLY_START_THRESHOLD_SECONDS = 6;
/** Speech-rate estimate used for highlighting while a chunk is still streaming. */
const CHARS_PER_SECOND = 14;
/** Playback speed multiplier (0.95 = slightly slower than natural). */
const PLAYBACK_RATE = 0.95;

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

/** Decode raw 16-bit little-endian PCM bytes into Float32 channel data. */
function decodeRawPcm(
    bytes: Uint8Array,
    channels: number,
    sampleRate: number,
): { channelData: Float32Array[]; channels: number; sampleRate: number } {
    const chan = Math.max(1, Math.floor(channels) || 1);
    const rate = Math.max(8000, Math.round(sampleRate) || DEFAULT_SAMPLE_RATE);
    const totalSamples = Math.floor(bytes.byteLength / 2);
    const perChannel = Math.floor(totalSamples / chan);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channelData: Float32Array[] = [];
    for (let c = 0; c < chan; c++) {
        const out = new Float32Array(perChannel);
        for (let j = 0; j < perChannel; j++) {
            out[j] = view.getInt16((j * chan + c) * 2, true) / 32768;
        }
        channelData.push(out);
    }
    return { channelData, channels: chan, sampleRate: rate };
}

/** Decode a raw 16-bit little-endian PCM delta (audio/l16 or audio/pcm). */
function decodePcmDelta(chunk: StreamAudioChunk): { channelData: Float32Array[]; channels: number; sampleRate: number } {
    return decodeRawPcm(base64ToUint8Array(chunk.data), chunk.channels, chunk.sampleRate);
}

/**
 * Some proxies label raw PCM as `audio/wav` without an actual WAV container.
 * Extract the payload of the `data` chunk when a RIFF header is present.
 */
function stripWavHeader(bytes: Uint8Array): Uint8Array | null {
    if (bytes.length < 12 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'RIFF') return null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
        const size = bytes[offset + 4] | (bytes[offset + 5] << 8) | (bytes[offset + 6] << 16) | (bytes[offset + 7] << 24);
        if (id === 'data') {
            const end = Math.min(offset + 8 + size, bytes.length);
            if (end > offset + 8) return bytes.subarray(offset + 8, end).slice();
            return null;
        }
        offset += 8 + size + (size % 2);
    }
    return null;
}

interface PendingChunk {
    text: string;
    offset: number;
    /** In-flight segment accumulation; null while no deltas are pending. */
    accumulator: SampleBuffer[] | null;
    sampleRate: number;
    channels: number;
    /** Seconds of audio received so far (finalized segments + accumulator). */
    receivedSeconds: number;
    done: boolean;
}

interface PlayableChunk {
    buffer: AudioBuffer;
    text: string;
    offset: number;
    chunkIndex: number;
    /** Seconds into the chunk's audio timeline where this segment starts. */
    startInChunk: number;
}

interface ActiveSource {
    source: AudioBufferSourceNode;
    piece: PlayableChunk;
    startTime: number;
}

export class TtsController {
    private audioContext: AudioContext | null = null;
    private abortController: AbortController | null = null;
    private chunks: TextChunk[] = [];
    private pendingChunks: PendingChunk[] = [];
    /** Per-chunk FIFO of playable segments; ordered so chunks never interleave. */
    private queues: PlayableChunk[][] = [];
    private currentChunkIndex = 0;
    private hasStartedPlayback = false;
    private streamsStarted: boolean[] = [];
    /** Cumulative seconds of audio enqueued per chunk (used for highlight mapping). */
    private chunkEnqueuedSeconds: number[] = [];
    private playing: ActiveSource | null = null;
    private aborted = false;
    private sessionId = 0;
    private segmentsEnqueued = 0;
    private diagLogged = false;
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
        console.debug('[tts] controller v5 (pre-roll buffered streaming)');
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
            accumulator: null,
            sampleRate: DEFAULT_SAMPLE_RATE,
            channels: 1,
            receivedSeconds: 0,
            done: false,
        }));
        this.chunkEnqueuedSeconds = new Array(chunks.length).fill(0);
        this.queues = chunks.map(() => []);
        this.currentChunkIndex = 0;
        this.hasStartedPlayback = false;
        this.streamsStarted = chunks.map((_, i) => i === 0);
        this.segmentsEnqueued = 0;
        this.diagLogged = false;
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

            if (index + 1 < this.chunks.length && !this.streamsStarted[index + 1]) {
                this.streamsStarted[index + 1] = true;
                void this.streamChunk(index + 1);
            } else if (index + 1 >= this.chunks.length && !this.playing && this.queues[index].length === 0) {
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

        if (!this.diagLogged) {
            this.diagLogged = true;
            console.debug(
                `[tts] first delta: mimeType=${chunk.mimeType} sampleRate=${chunk.sampleRate} channels=${chunk.channels} bytes=${(chunk.data.length * 3) / 4}`,
            );
        }

        let decoded: { channelData: Float32Array[]; channels: number; sampleRate: number };
        try {
            decoded = await this.decodeDelta(chunk, ctx);
        } catch (err) {
            console.debug('[tts] delta decode failed:', err);
            // If nothing has played for this chunk yet, surface the failure.
            if (pending.receivedSeconds === 0 && !pending.accumulator) throw err;
            return;
        }

        pending.channels = decoded.channels;
        pending.sampleRate = decoded.sampleRate;
        if (!pending.accumulator) pending.accumulator = [];
        for (let c = 0; c < decoded.channelData.length; c++) {
            if (!pending.accumulator[c]) pending.accumulator[c] = new SampleBuffer();
            pending.accumulator[c].append(decoded.channelData[c]);
        }

        // Start playing as soon as a segment's worth of audio has arrived; do not
        // wait for the whole chunk to finish streaming.
        const targetSamples = Math.floor(pending.sampleRate * SEGMENT_TARGET_SECONDS);
        if ((pending.accumulator[0]?.length ?? 0) >= targetSamples) {
            this.finalizeSegment(index);
        } else if (pending.done) {
            // Stream already finalized while this delta was decoding: flush it.
            this.finalizeSegment(index);
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
        try {
            const buffer = await ctx.decodeAudioData(bytes.buffer);
            const channelData: Float32Array[] = [];
            for (let c = 0; c < buffer.numberOfChannels; c++) {
                channelData.push(buffer.getChannelData(c).slice());
            }
            return { channelData, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate };
        } catch (err) {
            // Some sources label raw PCM as audio/wav; fall back to raw decoding
            // when the container is missing or undecodable.
            const payload = stripWavHeader(bytes);
            if (payload) {
                console.debug(`[tts] ${mime} delta had a RIFF header; decoded as raw PCM`);
                return decodeRawPcm(payload, chunk.channels, chunk.sampleRate);
            }
            throw err;
        }
    }

    /** Turn the accumulated samples into a playable AudioBuffer and queue it. */
    private finalizeSegment(index: number) {
        const pending = this.pendingChunks[index];
        const ctx = this.audioContext;
        if (!pending || !ctx) return;
        const accumulator = pending.accumulator;
        if (!accumulator || (accumulator[0]?.length ?? 0) === 0) {
            pending.accumulator = null;
            return;
        }

        const length = accumulator[0].length;
        const buffer = new AudioBuffer({
            numberOfChannels: Math.min(pending.channels, accumulator.length),
            length,
            sampleRate: pending.sampleRate,
        });
        for (let c = 0; c < buffer.numberOfChannels; c++) {
            buffer.copyToChannel(accumulator[c].toFloat32Array(), c);
        }
        pending.accumulator = null;
        pending.receivedSeconds += buffer.duration;

        this.queues[index].push({
            buffer,
            text: pending.text,
            offset: pending.offset,
            chunkIndex: index,
            startInChunk: this.chunkEnqueuedSeconds[index],
        });
        this.chunkEnqueuedSeconds[index] += buffer.duration;
        this.segmentsEnqueued++;
        this.playNext();
    }

    private finalizeChunk(index: number) {
        const pending = this.pendingChunks[index];
        if (!pending || pending.done) return;
        pending.done = true;
        // Flush whatever remains in the accumulator as a final segment.
        this.finalizeSegment(index);
    }

    private playNext() {
        if (this.playing || this.status === 'paused') return;
        const ctx = this.audioContext;
        if (!ctx) return;

        // Advance to the next chunk once the current one is fully drained.
        while (
            this.currentChunkIndex < this.chunks.length &&
            this.queues[this.currentChunkIndex].length === 0 &&
            this.pendingChunks[this.currentChunkIndex]?.done
        ) {
            this.currentChunkIndex++;
        }
        if (this.currentChunkIndex >= this.chunks.length) {
            if (this.pendingChunks.every((pending) => pending.done)) this.finishPlayback();
            return;
        }

        const queue = this.queues[this.currentChunkIndex];
        if (queue.length === 0) return; // Current chunk still streaming; stay loading.

        // Pre-roll: hold playback until the first chunk has buffered enough audio
        // so generation jitter cannot cause audible stutter.
        if (!this.hasStartedPlayback) {
            const queuedSeconds = queue.reduce((sum, piece) => sum + piece.buffer.duration, 0);
            const chunkDone = this.pendingChunks[this.currentChunkIndex]?.done;
            if (!chunkDone && queuedSeconds < PLAY_START_PREROLL_SECONDS) return;
            this.hasStartedPlayback = true;
            console.debug(`[tts] pre-roll reached (${Math.round(queuedSeconds)}s buffered), starting playback`);
        }

        const item = queue.shift();
        if (!item) return;

        const source = ctx.createBufferSource();
        source.buffer = item.buffer;
        source.playbackRate.value = PLAYBACK_RATE;
        source.connect(ctx.destination);

        this.playing = {
            source,
            piece: item,
            startTime: ctx.currentTime,
        };

        source.onended = () => {
            if (this.playing?.source !== source) return;
            this.playing = null;
            if (this.status === 'paused') return;
            this.playNext();
            if (!this.playing && this.status !== 'idle') {
                this.setStatus('loading', this.label);
            }
        };

        source.start();
        // The context is created within the user gesture, but re-resume here
        // in case the browser suspended it before the first segment arrived.
        if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
        this.setStatus('playing', this.label);
        this.startHighlightLoop();
        this.maybeStartNextStream();
    }

    /**
     * Start the next chunk's stream while the current one still plays, so the
     * model's prefill at chunk boundaries happens behind the buffer instead of
     * as an audible pause. Segments go to that chunk's own queue, preserving
     * playback order.
     */
    private maybeStartNextStream() {
        const index = this.currentChunkIndex;
        const next = index + 1;
        if (next >= this.chunks.length || this.streamsStarted[next]) return;

        if (!this.pendingChunks[index]?.done) {
            // Current chunk still streaming: only pre-start when its buffer is low.
            const queuedSeconds = this.queues[index].reduce((sum, piece) => sum + piece.buffer.duration, 0);
            if (queuedSeconds >= EARLY_START_THRESHOLD_SECONDS) return;
        }

        this.streamsStarted[next] = true;
        void this.streamChunk(next);
    }

    private finishPlayback() {
        if (this.segmentsEnqueued === 0) {
            this.emitError('The speech service returned no audio for this text.');
        }
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
        this.queues = [];
        this.pendingChunks = [];
        this.chunkEnqueuedSeconds = [];
        this.chunks = [];
        this.currentChunkIndex = 0;
        this.hasStartedPlayback = false;
        this.streamsStarted = [];
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

        const piece = current.piece;
        const pending = this.pendingChunks[piece.chunkIndex];
        if (!pending) return;

        // Position within the chunk's audio timeline: completed segments of this
        // chunk plus how far the current segment has played. `ctx.currentTime`
        // is real time, so scale by the playback rate to get content time.
        const chunkElapsed = (piece.startInChunk + (ctx.currentTime - current.startTime)) * PLAYBACK_RATE;

        // Duration estimate. While the chunk streams, use a constant speech-rate
        // estimate so the highlight moves forward smoothly; once the chunk is
        // done, blend toward the exact duration (monotonic, no jumps).
        const rateEstimate = piece.text.length / CHARS_PER_SECOND;
        let duration = rateEstimate;
        if (pending.done && pending.receivedSeconds > 0) {
            const blend = Math.min(1, chunkElapsed / pending.receivedSeconds);
            duration = rateEstimate + (pending.receivedSeconds - rateEstimate) * blend;
        }
        const fraction = duration > 0 ? Math.min(1, Math.max(0, chunkElapsed / duration)) : 0;
        const textIndex = Math.min(piece.text.length - 1, Math.floor(fraction * piece.text.length));

        const wordStart = this.baseOffset + piece.offset + expandWordStart(piece.text, textIndex);
        const wordEnd = this.baseOffset + piece.offset + expandWordEnd(piece.text, textIndex);
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
