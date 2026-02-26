const API_BASE = import.meta.env.PROD
    ? (import.meta.env.VITE_API_URL ?? 'https://api-ebook.duckdns.org')
    : '/api';

async function request<T>(
    endpoint: string,
    options: RequestInit = {}
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
