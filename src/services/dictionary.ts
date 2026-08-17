/**
 * Word-definition lookup with retries and a fallback source.
 *
 * The primary source (api.dictionaryapi.dev, a free community service) is
 * flaky: it intermittently answers 502 without CORS headers, which the browser
 * surfaces as `TypeError: Failed to fetch`. Retrying handles the transient
 * failures; if all attempts fail we fall back to the Wiktionary REST API
 * (Wikimedia infra, CORS-enabled, no rate limits).
 */

const PRIMARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const FALLBACK_API = 'https://en.wiktionary.org/api/rest_v1/page/definition/';

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

interface DictionaryEntry {
    word?: string;
    phonetic?: string;
    phonetics?: Array<{
        text?: string;
    }>;
    meanings?: Array<{
        partOfSpeech?: string;
        definitions?: Array<{
            definition?: string;
        }>;
    }>;
}

interface WiktionaryEntry {
    partOfSpeech?: string;
    definitions?: Array<{
        definition?: string;
    }>;
}

export interface DictionaryMeaning {
    partOfSpeech: string;
    definitions: string[];
}

export interface DictionaryLookupResult {
    word: string;
    phonetic: string;
    primaryDefinition: string;
    primaryPartOfSpeech: string;
    meanings: DictionaryMeaning[];
    vocabDefinition: string;
}

class DictionaryError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'DictionaryError';
        this.status = status;
    }
}

/**
 * Fetches with retries. Retries on transport-level failures (network errors,
 * CORS-blocked 5xx from a proxy without CORS headers) and on HTTP 5xx
 * responses. Returns the last response when all attempts are exhausted so the
 * caller can report a meaningful error.
 */
async function fetchWithRetry(url: string): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url);
            if (res.status >= 500 && res.status < 600 && attempt < RETRY_ATTEMPTS) {
                lastError = new DictionaryError(`Dictionary service error (${res.status})`, res.status);
            } else {
                return res;
            }
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
        if (attempt < RETRY_ATTEMPTS) {
            const { promise, resolve } = Promise.withResolvers<void>();
            setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt);
            await promise;
        }
    }
    throw lastError ?? new Error('Failed to fetch definition');
}

function buildResult(
    word: string,
    phonetic: string,
    meanings: DictionaryMeaning[]
): DictionaryLookupResult {
    const firstMeaning = meanings[0];
    const firstDefinition = firstMeaning?.definitions[0] || '';
    const vocabDefinition = meanings
        .slice(0, 3)
        .map((meaning) => {
            const summary = meaning.definitions.slice(0, 2).join('; ');
            return meaning.partOfSpeech ? `${meaning.partOfSpeech}: ${summary}` : summary;
        })
        .join(' | ');

    return {
        word,
        phonetic,
        primaryDefinition: firstDefinition,
        primaryPartOfSpeech: firstMeaning?.partOfSpeech || '',
        meanings,
        vocabDefinition,
    };
}

async function lookupFromDictionaryApi(word: string): Promise<DictionaryLookupResult> {
    const response = await fetchWithRetry(`${PRIMARY_API}${encodeURIComponent(word)}`);
    if (response.status === 404) {
        throw new DictionaryError('Word not found', 404);
    }
    if (!response.ok) {
        throw new DictionaryError(`Dictionary service error (${response.status})`, response.status);
    }

    const data = (await response.json()) as DictionaryEntry[];
    const firstEntry = data[0];
    const meanings = (firstEntry?.meanings || [])
        .map((meaning) => ({
            partOfSpeech: meaning.partOfSpeech || '',
            definitions: (meaning.definitions || [])
                .map((definition) => definition.definition?.trim() || '')
                .filter(Boolean),
        }))
        .filter((meaning) => meaning.definitions.length > 0);

    if (meanings.length === 0) {
        throw new DictionaryError('Definition not found', 404);
    }

    return buildResult(
        firstEntry?.word?.trim().toLowerCase() || word,
        firstEntry?.phonetic || firstEntry?.phonetics?.find((item) => item.text)?.text || '',
        meanings
    );
}

function stripHtml(html: string): string {
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

async function lookupFromWiktionary(word: string): Promise<DictionaryLookupResult> {
    const response = await fetchWithRetry(`${FALLBACK_API}${encodeURIComponent(word)}`);
    if (response.status === 404) {
        throw new DictionaryError('Word not found', 404);
    }
    if (!response.ok) {
        throw new DictionaryError(`Dictionary service error (${response.status})`, response.status);
    }

    const data = (await response.json()) as Record<string, WiktionaryEntry[]>;
    const englishEntries = data.en || [];
    const meanings = englishEntries
        .map((entry) => ({
            partOfSpeech: entry.partOfSpeech || '',
            definitions: (entry.definitions || [])
                .map((definition) => stripHtml(definition.definition || ''))
                .filter(Boolean),
        }))
        .filter((meaning) => meaning.definitions.length > 0);

    if (meanings.length === 0) {
        throw new DictionaryError('Definition not found', 404);
    }

    return buildResult(word, '', meanings);
}

export async function lookupWordDefinition(word: string): Promise<DictionaryLookupResult> {
    const trimmed = word.trim().toLowerCase();
    if (!trimmed) {
        throw new Error('Word is required');
    }

    try {
        return await lookupFromDictionaryApi(trimmed);
    } catch (primaryError) {
        try {
            return await lookupFromWiktionary(trimmed);
        } catch (wiktionaryError) {
            const primaryNotFound =
                primaryError instanceof DictionaryError && primaryError.status === 404;
            const wiktionaryNotFound =
                wiktionaryError instanceof DictionaryError && wiktionaryError.status === 404;
            if (primaryNotFound || wiktionaryNotFound) {
                throw new Error('Word not found');
            }
            throw new Error('Failed to fetch definition');
        }
    }
}
