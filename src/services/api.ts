const API_BASE = import.meta.env.PROD
    ? (import.meta.env.VITE_API_URL || 'https://api-ebook.duckdns.org')
    : '/api';

async function request<T>(
    endpoint: string,
    options: RequestInit = {},
    extra: { skipAuthExpiry?: boolean } = {}
): Promise<T> {
    const token = localStorage.getItem('easyread_token');
    const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> || {}),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Don't set Content-Type for FormData (browser sets it with boundary)
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
    });

    if (res.status === 401 && token && !extra.skipAuthExpiry) {
        localStorage.removeItem('easyread_token');
        localStorage.removeItem('easyread_userId');
        sessionStorage.setItem('easyread_session_expired', '1');
        window.dispatchEvent(new Event('session-expired'));
        return new Promise<T>(() => {});
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `Request failed (${res.status})`);
    }

    // Handle 204 No Content
    if (res.status === 204) return {} as T;

    return res.json();
}

/* ── Auth ─────────────────────────────────────────────────────── */
export async function signup(email: string, password: string) {
    return request<{ message: string }>('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
}

export async function login(email: string, password: string) {
    return request<{ token: string; userId: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
}

export async function changePassword(oldPassword: string, newPassword: string) {
    return request<{ message: string }>('/auth/change-password', {
        method: 'PATCH',
        body: JSON.stringify({ oldPassword, newPassword }),
    });
}

/* ── Books ────────────────────────────────────────────────────── */
export interface VocabEntry {
    _id?: string;
    word: string;
    definition: string;
}

export interface Note {
    _id: string;
    title: string;
    content: string;
    createdAt: string;
}

export interface Book {
    _id: string;
    title: string;
    pdfUrl: string;
    cloudinaryId: string;
    totalPages: number;
    currentPage: number;
    owner: string;
    vocabulary: VocabEntry[];
    notes: Note[];
    progressPercentage: number;
}

export async function getBooks() {
    return request<Book[]>('/books');
}

export async function uploadBook(file: File, title?: string) {
    const form = new FormData();
    form.append('pdf', file);
    if (title) form.append('title', title);

    return request<Book>('/upload-book', {
        method: 'POST',
        body: form,
    });
}

export async function deleteBook(id: string) {
    return request<{ message: string }>(`/books/${id}`, {
        method: 'DELETE',
    });
}

/* ── Progress ─────────────────────────────────────────────────── */
export async function updateProgress(bookId: string, page: number) {
    return request<{ page: number; percent: number }>(`/books/${bookId}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ page }),
    });
}

/* ── Vocabulary ───────────────────────────────────────────────── */
export async function addVocab(bookId: string, word: string, definition: string) {
    return request<VocabEntry[]>(`/books/${bookId}/vocab`, {
        method: 'POST',
        body: JSON.stringify({ word, definition }),
    });
}

export async function editVocab(
    bookId: string,
    vocabId: string,
    data: { word?: string; definition?: string }
) {
    return request<VocabEntry>(`/books/${bookId}/vocab/${vocabId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

export async function deleteVocab(bookId: string, vocabId: string) {
    return request<{ message: string }>(`/books/${bookId}/vocab/${vocabId}`, {
        method: 'DELETE',
    });
}

/* ── Dictionary ──────────────────────────────────────────────── */
export type { DictionaryMeaning, DictionaryLookupResult } from './dictionary';
export { lookupWordDefinition } from './dictionary';

/* ── Notes ────────────────────────────────────────────────────── */
export async function getNotes(bookId: string) {
    return request<Note[]>(`/books/${bookId}/notes`);
}

export async function addNote(bookId: string, title: string, content: string) {
    return request<Note>(`/books/${bookId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ title, content }),
    });
}

export async function updateNote(
    bookId: string,
    noteId: string,
    data: { title?: string; content?: string }
) {
    return request<Note>(`/books/${bookId}/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

export async function deleteNote(bookId: string, noteId: string) {
    return request<{ message: string }>(`/books/${bookId}/notes/${noteId}`, {
        method: 'DELETE',
    });
}

/* ── Text-to-speech ──────────────────────────────────────────── */
export interface StreamAudioChunk {
    data: string; // base64-encoded audio
    mimeType: string;
    sampleRate: number;
    channels: number;
}

export interface StreamSpeechHandlers {
    onAudio: (chunk: StreamAudioChunk) => void;
}

/**
 * Opens a streaming TTS session. Resolves when the server sends `done`.
 * The server relays newline-delimited JSON: audio chunks, an error event, then
 * `done`. Throws if the request fails or the server reports an error.
 */
export async function streamSpeech(
    text: string,
    handlers: StreamSpeechHandlers,
    signal?: AbortSignal
): Promise<void> {
    const token = localStorage.getItem('easyread_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    headers['Content-Type'] = 'application/json';

    const res = await fetch(`${API_BASE}/tts/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
        signal,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `Request failed (${res.status})`);
    }
    if (!res.body) {
        throw new Error('Streaming responses are not supported by this browser.');
    }

    // Proxies/CDNs may compress the NDJSON stream even though it is streaming
    // (browsers cannot opt out of Accept-Encoding). Decompress transparently so
    // the line parser never sees gzip bytes.
    let body = res.body;
    const contentEncoding = res.headers.get('content-encoding')?.toLowerCase();
    if (contentEncoding && contentEncoding !== 'identity') {
        console.debug(`[tts] response content-encoding: ${contentEncoding}`);
        if (contentEncoding === 'br') {
            throw new Error('TTS stream is Brotli-compressed; configure the server to disable compression for /tts/stream.');
        }
        const format = contentEncoding === 'deflate' ? 'deflate' : 'gzip';
        body = body.pipeThrough(new DecompressionStream(format));
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lineCount = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (!line) continue;

            let message: { type?: string; message?: string } & Partial<StreamAudioChunk>;
            try {
                message = JSON.parse(line);
            } catch {
                lineCount++;
                if (lineCount === 1) {
                    console.debug('[tts] first unparseable line:', line.slice(0, 120));
                }
                continue; // Ignore malformed lines defensively.
            }

            if (message.type === 'audio' && typeof message.data === 'string') {
                // Await so decode/accumulate completes before the stream resolves;
                // otherwise late deltas can race chunk finalization and be dropped.
                await handlers.onAudio({
                    data: message.data,
                    mimeType: message.mimeType || 'audio/l16',
                    sampleRate: message.sampleRate || 24000,
                    channels: message.channels || 1,
                });
            } else if (message.type === 'error') {
                throw new Error(message.message || 'TTS stream failed.');
            } else if (message.type === 'done') {
                return;
            }
        }
    }
}
