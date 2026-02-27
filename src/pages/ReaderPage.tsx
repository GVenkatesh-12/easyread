import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Navbar from '../components/Navbar';
import { useToast } from '../components/Toast';
import * as api from '../services/api';
import type { Book, Note, VocabEntry } from '../services/api';
import {
    ChevronLeft,
    ChevronRight,
    Palette,
    StickyNote,
    BookA,
    Plus,
    Minus,
    X,
    Save,
    Trash2,
    Edit3,
    Loader2,
    Sun,
    Moon,
    Sunset,
    Flame,
    Eye,
    Columns2,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

type PdfTheme = 'default' | 'dark' | 'sepia' | 'warm' | 'blue-night';

interface ThemeOption {
    id: PdfTheme;
    label: string;
    icon: React.ReactNode;
    preview: string;
}

const THEME_OPTIONS: ThemeOption[] = [
    { id: 'default', label: 'Default', icon: <Sun size={16} />, preview: '#ffffff' },
    { id: 'dark', label: 'Dark', icon: <Moon size={16} />, preview: '#1a1a2e' },
    { id: 'sepia', label: 'Sepia', icon: <Sunset size={16} />, preview: '#f4e8d1' },
    { id: 'warm', label: 'Warm', icon: <Flame size={16} />, preview: '#fef3e2' },
    { id: 'blue-night', label: 'Blue Night', icon: <Eye size={16} />, preview: '#1a1a3e' },
];

export default function ReaderPage() {
    const { bookId } = useParams<{ bookId: string }>();
    const { showToast } = useToast();

    const [book, setBook] = useState<Book | null>(null);
    const [loading, setLoading] = useState(true);
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [rendering, setRendering] = useState(false);
    const [pdfTheme, setPdfTheme] = useState<PdfTheme>('default');
    const [showThemePicker, setShowThemePicker] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(1.0);
    const [maxPageWidth, setMaxPageWidth] = useState(0);
    const [pageInput, setPageInput] = useState('1');
    const [isNarrowViewport, setIsNarrowViewport] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(false);

    const [showNotes, setShowNotes] = useState(false);
    const [showVocab, setShowVocab] = useState(false);
    const [notes, setNotes] = useState<Note[]>([]);
    const [vocab, setVocab] = useState<VocabEntry[]>([]);

    const [noteTitle, setNoteTitle] = useState('');
    const [noteContent, setNoteContent] = useState('');
    const [editingNote, setEditingNote] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');

    const [vocabWord, setVocabWord] = useState('');
    const [vocabDef, setVocabDef] = useState('');
    const [editingVocab, setEditingVocab] = useState<string | null>(null);
    const [editVocabWord, setEditVocabWord] = useState('');
    const [editVocabDef, setEditVocabDef] = useState('');

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const themePickerRef = useRef<HTMLDivElement>(null);
    const progressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!bookId) return;
        (async () => {
            try {
                const books = await api.getBooks();
                const found = books.find((b) => b._id === bookId);
                if (!found) throw new Error('Book not found');
                setBook(found);
                setCurrentPage(found.currentPage > 0 ? found.currentPage : 1);
                setVocab(found.vocabulary);
                const notesData = await api.getNotes(bookId);
                setNotes(notesData);
            } catch (err: any) {
                showToast(err.message || 'Failed to load book', 'error');
            }
        })();
    }, [bookId]);

    useEffect(() => {
        const updateViewport = () => {
            setIsNarrowViewport(window.innerWidth <= 1024);
            setIsMobileViewport(window.innerWidth <= 768);
        };
        updateViewport();
        window.addEventListener('resize', updateViewport);
        return () => window.removeEventListener('resize', updateViewport);
    }, []);

    useEffect(() => {
        setPageInput(String(currentPage));
    }, [currentPage]);

    useEffect(() => {
        if (!book) return;
        setLoading(true);
        const loadPdf = async () => {
            try {
                const doc = await pdfjsLib.getDocument(book.pdfUrl).promise;
                setPdfDoc(doc);
                setTotalPages(doc.numPages);
            } catch (err: any) {
                showToast('Failed to load PDF: ' + (err.message || ''), 'error');
            } finally {
                setLoading(false);
            }
        };
        loadPdf();
    }, [book]);

    const renderPage = useCallback(async () => {
        if (!pdfDoc || !canvasRef.current || !containerRef.current) return;
        setRendering(true);
        try {
            const page = await pdfDoc.getPage(currentPage);
            const container = containerRef.current;
            const horizontalInset = isMobileViewport ? 16 : 40;
            const containerWidth = Math.max(container.clientWidth - horizontalInset, 180);
            const effectiveWidth = maxPageWidth > 0 && !isMobileViewport
                ? Math.min(containerWidth, maxPageWidth)
                : containerWidth;
            const viewport = page.getViewport({ scale: 1 });
            const fitScale = effectiveWidth / viewport.width;
            let baseScale = fitScale;
            if (isMobileViewport) {
                const reservedHeight = 140;
                const availableHeight = Math.max(container.clientHeight - reservedHeight, 180);
                const fitHeightScale = availableHeight / viewport.height;
                // On phones, prefer filling vertical space even if this introduces horizontal scroll.
                baseScale = Math.max(fitScale, fitHeightScale);
            }
            const scale = baseScale * zoomLevel;
            const scaledViewport = page.getViewport({ scale });
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d')!;
            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;
            await page.render({ canvasContext: ctx, canvas, viewport: scaledViewport }).promise;
        } catch (err) {
            console.error('Render error:', err);
        } finally {
            setRendering(false);
        }
    }, [pdfDoc, currentPage, zoomLevel, maxPageWidth, isMobileViewport]);

    useEffect(() => { renderPage(); }, [renderPage]);

    useEffect(() => {
        const handleResize = () => renderPage();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [renderPage]);

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (!themePickerRef.current) return;
            if (!themePickerRef.current.contains(e.target as Node)) {
                setShowThemePicker(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    useEffect(() => {
        if (!bookId || !totalPages) return;
        if (progressTimeout.current) clearTimeout(progressTimeout.current);
        progressTimeout.current = setTimeout(async () => {
            try { await api.updateProgress(bookId, currentPage); } catch { /* silent */ }
        }, 1000);
        return () => { if (progressTimeout.current) clearTimeout(progressTimeout.current); };
    }, [currentPage, bookId, totalPages]);

    const goToPage = (page: number) => {
        if (page >= 1 && page <= totalPages) setCurrentPage(page);
    };

    const WIDTH_PRESETS = [
        { value: 0, label: 'Full' },
        { value: 900, label: 'Wide' },
        { value: 700, label: 'Medium' },
        { value: 550, label: 'Narrow' },
    ];

    const cyclePageWidth = () => {
        const idx = WIDTH_PRESETS.findIndex(p => p.value === maxPageWidth);
        const next = (idx + 1) % WIDTH_PRESETS.length;
        setMaxPageWidth(WIDTH_PRESETS[next].value);
    };

    const currentWidthLabel = WIDTH_PRESETS.find(p => p.value === maxPageWidth)?.label ?? 'Full';

    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 2.5;
    const ZOOM_STEP = 0.25;

    const zoomIn = () => setZoomLevel(z => Math.min(z + ZOOM_STEP, ZOOM_MAX));
    const zoomOut = () => setZoomLevel(z => Math.max(z - ZOOM_STEP, ZOOM_MIN));
    const zoomPercent = Math.round(zoomLevel * 100);

    const handleAddNote = async () => {
        if (!bookId || !noteTitle.trim() || !noteContent.trim()) return;
        try {
            const note = await api.addNote(bookId, noteTitle.trim(), noteContent.trim());
            setNotes((prev) => [note, ...prev]);
            setNoteTitle('');
            setNoteContent('');
            showToast('Note added', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to add note', 'error');
        }
    };

    const handleUpdateNote = async (noteId: string) => {
        if (!bookId) return;
        try {
            const updated = await api.updateNote(bookId, noteId, { title: editTitle, content: editContent });
            setNotes((prev) => prev.map((n) => (n._id === noteId ? updated : n)));
            setEditingNote(null);
            showToast('Note updated', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to update note', 'error');
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        if (!bookId) return;
        try {
            await api.deleteNote(bookId, noteId);
            setNotes((prev) => prev.filter((n) => n._id !== noteId));
            showToast('Note deleted', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to delete note', 'error');
        }
    };

    const addVocabEntry = async (word: string, definition: string) => {
        if (!bookId || !word.trim() || !definition.trim()) return;
        try {
            const updatedVocab = await api.addVocab(bookId, word.trim(), definition.trim());
            setVocab(updatedVocab);
            showToast('Word added', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to add vocabulary', 'error');
            throw err;
        }
    };

    const handleAddVocab = async () => {
        try {
            await addVocabEntry(vocabWord, vocabDef);
            setVocabWord('');
            setVocabDef('');
        } catch {
            // Error toast is handled in addVocabEntry.
        }
    };

    const handleEditVocab = async (vocabId: string) => {
        if (!bookId) return;
        try {
            const updated = await api.editVocab(bookId, vocabId, { word: editVocabWord, definition: editVocabDef });
            setVocab((prev) => prev.map((v) => (v._id === vocabId ? updated : v)));
            setEditingVocab(null);
            showToast('Word updated', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to update vocabulary', 'error');
        }
    };

    const handleDeleteVocab = async (vocabId: string) => {
        if (!bookId) return;
        try {
            await api.deleteVocab(bookId, vocabId);
            setVocab((prev) => prev.filter((v) => v._id !== vocabId));
            showToast('Word deleted', 'success');
        } catch (err: any) {
            showToast(err.message || 'Failed to delete vocabulary', 'error');
        }
    };

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'Escape') {
                setShowThemePicker(false);
                setShowNotes(false);
                setShowVocab(false);
            }
            if (e.key === 'ArrowLeft') goToPage(currentPage - 1);
            if (e.key === 'ArrowRight') goToPage(currentPage + 1);
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const container = containerRef.current;
                if (!container) return;
                e.preventDefault();
                const direction = e.key === 'ArrowUp' ? -1 : 1;
                container.scrollBy({ top: direction * 120, behavior: 'smooth' });
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [currentPage, totalPages]);

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '8px 12px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text)',
        fontSize: '0.85rem',
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s',
    };

    const toolbarBtn = (active: boolean): React.CSSProperties => ({
        background: active ? 'var(--color-accent-soft)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-full)',
        width: isMobileViewport ? '32px' : '36px',
        height: isMobileViewport ? '32px' : '36px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        transition: 'background 0.15s, color 0.15s',
        position: 'relative',
    });

    const smallIconBtn: React.CSSProperties = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        display: 'flex',
        borderRadius: 'var(--radius-full)',
        transition: 'background 0.15s',
    };

    const readingPercent = totalPages > 0 ? Math.round((currentPage / totalPages) * 100) : 0;
    const showOverlayPanel = isNarrowViewport && (showNotes || showVocab);
    const toolbarIconSize = isMobileViewport ? 16 : 18;

    const commitPageInput = () => {
        const parsed = parseInt(pageInput, 10);
        if (Number.isNaN(parsed)) {
            setPageInput(String(currentPage));
            return;
        }
        goToPage(parsed);
        setPageInput(String(Math.max(1, Math.min(parsed, totalPages || 1))));
    };

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Navbar
                title={book?.title || 'Loading...'}
                showBack
                onAddVocabFromLookup={addVocabEntry}
            >
                <div style={{ display: 'flex', gap: '4px', marginLeft: isMobileViewport ? '2px' : '8px' }}>
                    <div ref={themePickerRef} style={{ position: 'relative' }}>
                        <button
                            onClick={() => { setShowThemePicker(!showThemePicker); setShowNotes(false); setShowVocab(false); }}
                            style={toolbarBtn(showThemePicker)}
                            onMouseEnter={e => { if (!showThemePicker) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                            onMouseLeave={e => { if (!showThemePicker) e.currentTarget.style.background = 'transparent'; }}
                            aria-label="Reading theme"
                        >
                            <Palette size={toolbarIconSize} />
                        </button>

                        {showThemePicker && (
                            <div
                                className="animate-fade-in"
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    right: 0,
                                    marginTop: '8px',
                                    background: 'var(--color-surface)',
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '4px',
                                    boxShadow: 'var(--shadow-2)',
                                    zIndex: 60,
                                    minWidth: isMobileViewport ? '160px' : '180px',
                                }}
                            >
                                <p style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--color-text-secondary)', padding: '8px 12px 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Reading Theme
                                </p>
                                {THEME_OPTIONS.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => { setPdfTheme(t.id); setShowThemePicker(false); }}
                                        style={{
                                            width: '100%',
                                            padding: '8px 12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            background: pdfTheme === t.id ? 'var(--color-accent-soft)' : 'transparent',
                                            border: 'none',
                                            borderRadius: 'var(--radius-sm)',
                                            cursor: 'pointer',
                                            color: pdfTheme === t.id ? 'var(--color-accent)' : 'var(--color-text)',
                                            fontSize: '0.85rem',
                                            fontWeight: pdfTheme === t.id ? 500 : 400,
                                            textAlign: 'left',
                                            transition: 'background 0.1s',
                                        }}
                                        onMouseEnter={e => { if (pdfTheme !== t.id) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                                        onMouseLeave={e => { if (pdfTheme !== t.id) e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <div
                                            style={{
                                                width: '18px',
                                                height: '18px',
                                                borderRadius: 'var(--radius-full)',
                                                background: t.preview,
                                                border: '2px solid var(--color-border)',
                                                flexShrink: 0,
                                            }}
                                        />
                                        {t.icon}
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => { setShowNotes(!showNotes); setShowVocab(false); setShowThemePicker(false); }}
                        style={toolbarBtn(showNotes)}
                        onMouseEnter={e => { if (!showNotes) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                        onMouseLeave={e => { if (!showNotes) e.currentTarget.style.background = 'transparent'; }}
                        aria-label="Notes"
                    >
                        <StickyNote size={toolbarIconSize} />
                        {notes.length > 0 && (
                            <span style={{
                                position: 'absolute', top: '0', right: '0',
                                width: '16px', height: '16px', borderRadius: 'var(--radius-full)',
                                background: 'var(--color-accent)', color: 'white',
                                fontSize: '0.6rem', fontWeight: 600,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                {notes.length}
                            </span>
                        )}
                    </button>

                    <button
                        onClick={() => { setShowVocab(!showVocab); setShowNotes(false); setShowThemePicker(false); }}
                        style={toolbarBtn(showVocab)}
                        onMouseEnter={e => { if (!showVocab) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                        onMouseLeave={e => { if (!showVocab) e.currentTarget.style.background = 'transparent'; }}
                        aria-label="Vocabulary"
                    >
                        <BookA size={toolbarIconSize} />
                        {vocab.length > 0 && (
                            <span style={{
                                position: 'absolute', top: '0', right: '0',
                                width: '16px', height: '16px', borderRadius: 'var(--radius-full)',
                                background: 'var(--color-accent)', color: 'white',
                                fontSize: '0.6rem', fontWeight: 600,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                {vocab.length}
                            </span>
                        )}
                    </button>
                </div>
            </Navbar>

            <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', overflow: 'hidden' }}>
                <div
                    ref={containerRef}
                    className={`pdf-theme-${pdfTheme}`}
                    style={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isMobileViewport ? 'flex-start' : 'center',
                        overflow: 'auto',
                        padding: isMobileViewport ? '8px' : (isNarrowViewport ? '12px' : '20px'),
                        background: pdfTheme === 'dark' || pdfTheme === 'blue-night' ? '#1a1a2e' : 'var(--color-bg)',
                        transition: 'background 0.2s',
                    }}
                >
                    {!loading && pdfDoc && (
                        <div
                            style={{
                                width: '100%',
                                maxWidth: maxPageWidth || 1000,
                                marginBottom: '10px',
                                padding: '8px 10px',
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--color-surface)',
                                border: '1px solid var(--color-border)',
                                boxShadow: 'var(--shadow-1)',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '6px' }}>
                                <span>Reading progress</span>
                                <span>{readingPercent}%</span>
                            </div>
                            <div style={{ height: '6px', borderRadius: '999px', background: 'var(--color-bg)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${readingPercent}%`, borderRadius: '999px', background: 'var(--color-accent)', transition: 'width 0.2s ease' }} />
                            </div>
                        </div>
                    )}

                    {loading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px' }}>
                            <Loader2 size={36} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />
                        </div>
                    )}

                    {!loading && pdfDoc && (
                        <>
                            <canvas
                                ref={canvasRef}
                                style={{
                                    maxWidth: isMobileViewport ? 'none' : '100%',
                                    borderRadius: 'var(--radius-sm)',
                                    boxShadow: 'var(--shadow-1)',
                                }}
                            />

                            <div
                                style={{
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    flexWrap: isNarrowViewport ? 'wrap' : 'nowrap',
                                    justifyContent: isMobileViewport ? 'space-between' : 'center',
                                    gap: isMobileViewport ? '4px' : '6px',
                                    width: isMobileViewport ? '100%' : 'auto',
                                    padding: isMobileViewport ? '8px' : '6px 10px',
                                    borderRadius: isMobileViewport ? 'var(--radius-md)' : 'var(--radius-full)',
                                    marginTop: '16px',
                                    background: 'var(--color-surface)',
                                    boxShadow: 'var(--shadow-2)',
                                    border: '1px solid var(--color-border)',
                                }}
                            >
                                {/* Page width toggle */}
                                <button
                                    onClick={cyclePageWidth}
                                    title={`Page width: ${currentWidthLabel}`}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: 'var(--radius-full)',
                                        height: '32px',
                                        padding: isMobileViewport ? '0 8px' : '0 10px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        color: 'var(--color-text-secondary)',
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        transition: 'background 0.15s',
                                        whiteSpace: 'nowrap',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    aria-label="Toggle page width"
                                >
                                    <Columns2 size={15} />
                                    {!isMobileViewport && currentWidthLabel}
                                </button>

                                {!isMobileViewport && (
                                    <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', flexShrink: 0 }} />
                                )}

                                {/* Page navigation */}
                                <button
                                    onClick={() => goToPage(currentPage - 1)}
                                    disabled={currentPage <= 1}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: 'var(--radius-full)',
                                        width: '32px',
                                        height: '32px',
                                        cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                                        opacity: currentPage <= 1 ? 0.3 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--color-text)',
                                        transition: 'background 0.15s',
                                    }}
                                    aria-label="Previous page"
                                >
                                    <ChevronLeft size={18} />
                                </button>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <input
                                        type="number"
                                        min={1}
                                        max={totalPages}
                                        value={pageInput}
                                        onChange={(e) => setPageInput(e.target.value)}
                                        onBlur={commitPageInput}
                                        onKeyDown={(e) => { if (e.key === 'Enter') commitPageInput(); }}
                                        style={{
                                            width: isMobileViewport ? '52px' : '46px',
                                            padding: '3px',
                                            textAlign: 'center',
                                            background: 'var(--color-bg)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-sm)',
                                            color: 'var(--color-text)',
                                            fontSize: '0.8rem',
                                            fontWeight: 500,
                                            outline: 'none',
                                        }}
                                    />
                                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>
                                        / {totalPages}
                                    </span>
                                </div>

                                <button
                                    onClick={() => goToPage(currentPage + 1)}
                                    disabled={currentPage >= totalPages}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: 'var(--radius-full)',
                                        width: '32px',
                                        height: '32px',
                                        cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                                        opacity: currentPage >= totalPages ? 0.3 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--color-text)',
                                        transition: 'background 0.15s',
                                    }}
                                    aria-label="Next page"
                                >
                                    <ChevronRight size={18} />
                                </button>

                                {rendering && (
                                    <Loader2 size={14} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />
                                )}

                                {!isMobileViewport && (
                                    <div style={{ width: '1px', height: '20px', background: 'var(--color-border)', flexShrink: 0 }} />
                                )}

                                {/* Zoom controls */}
                                <button
                                    onClick={zoomOut}
                                    disabled={zoomLevel <= ZOOM_MIN}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: 'var(--radius-full)',
                                        width: '28px',
                                        height: '28px',
                                        cursor: zoomLevel <= ZOOM_MIN ? 'not-allowed' : 'pointer',
                                        opacity: zoomLevel <= ZOOM_MIN ? 0.3 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--color-text-secondary)',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => { if (zoomLevel > ZOOM_MIN) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    aria-label="Zoom out"
                                >
                                    <Minus size={15} />
                                </button>

                                <span
                                    onClick={() => setZoomLevel(1.0)}
                                    title="Reset zoom"
                                    style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 500,
                                        color: 'var(--color-text-secondary)',
                                        minWidth: '36px',
                                        textAlign: 'center',
                                        cursor: 'pointer',
                                        userSelect: 'none',
                                    }}
                                >
                                    {zoomPercent}%
                                </span>

                                <button
                                    onClick={zoomIn}
                                    disabled={zoomLevel >= ZOOM_MAX}
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        borderRadius: 'var(--radius-full)',
                                        width: '28px',
                                        height: '28px',
                                        cursor: zoomLevel >= ZOOM_MAX ? 'not-allowed' : 'pointer',
                                        opacity: zoomLevel >= ZOOM_MAX ? 0.3 : 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'var(--color-text-secondary)',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => { if (zoomLevel < ZOOM_MAX) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                    aria-label="Zoom in"
                                >
                                    <Plus size={15} />
                                </button>

                                {!isMobileViewport && (
                                    <span
                                        style={{
                                            fontSize: '0.7rem',
                                            color: 'var(--color-text-secondary)',
                                            marginLeft: '4px',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        ←/→ keys
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {showOverlayPanel && (
                    <div
                        onClick={() => { setShowNotes(false); setShowVocab(false); }}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'rgba(0, 0, 0, 0.4)',
                            zIndex: 50,
                        }}
                    />
                )}

                {showNotes && (
                    <div
                        className="animate-slide-in-right"
                        style={{
                            width: isNarrowViewport ? '100%' : '360px',
                            maxWidth: isNarrowViewport ? '100%' : '90vw',
                            position: isNarrowViewport ? 'absolute' : 'relative',
                            right: 0,
                            top: 0,
                            bottom: 0,
                            zIndex: isNarrowViewport ? 60 : 'auto',
                            borderLeft: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                            overflow: 'hidden',
                        }}
                    >
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontWeight: 500, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <StickyNote size={18} style={{ color: 'var(--color-accent)' }} />
                                Notes
                            </h3>
                            <button
                                onClick={() => setShowNotes(false)}
                                style={{ ...smallIconBtn, color: 'var(--color-text-secondary)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                            <input
                                placeholder="Note title"
                                value={noteTitle}
                                onChange={(e) => setNoteTitle(e.target.value)}
                                style={{ ...inputStyle, marginBottom: '8px' }}
                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                            />
                            <textarea
                                placeholder="Note content..."
                                value={noteContent}
                                onChange={(e) => setNoteContent(e.target.value)}
                                rows={3}
                                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', marginBottom: '8px' }}
                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                            />
                            <button
                                onClick={handleAddNote}
                                disabled={!noteTitle.trim() || !noteContent.trim()}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'var(--color-accent)',
                                    color: '#fff',
                                    fontWeight: 500,
                                    fontSize: '0.8rem',
                                    border: 'none',
                                    cursor: !noteTitle.trim() || !noteContent.trim() ? 'not-allowed' : 'pointer',
                                    opacity: !noteTitle.trim() || !noteContent.trim() ? 0.5 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                }}
                            >
                                <Plus size={14} />
                                Add Note
                            </button>
                        </div>

                        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px' }}>
                            {notes.length === 0 && (
                                <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '24px', fontSize: '0.85rem' }}>
                                    No notes yet. Add your first note above.
                                </p>
                            )}
                            {notes.map((note) => (
                                <div
                                    key={note._id}
                                    style={{
                                        padding: '12px',
                                        borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--color-border)',
                                        marginBottom: '8px',
                                        background: 'var(--color-bg)',
                                    }}
                                >
                                    {editingNote === note._id ? (
                                        <>
                                            <input
                                                value={editTitle}
                                                onChange={(e) => setEditTitle(e.target.value)}
                                                style={{ ...inputStyle, marginBottom: '6px' }}
                                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                                            />
                                            <textarea
                                                value={editContent}
                                                onChange={(e) => setEditContent(e.target.value)}
                                                rows={3}
                                                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', marginBottom: '6px' }}
                                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                                            />
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    onClick={() => handleUpdateNote(note._id)}
                                                    style={{
                                                        flex: 1, padding: '6px',
                                                        background: 'var(--color-accent)', color: '#fff',
                                                        border: 'none', borderRadius: 'var(--radius-full)',
                                                        cursor: 'pointer', fontWeight: 500, fontSize: '0.75rem',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                                                    }}
                                                >
                                                    <Save size={12} /> Save
                                                </button>
                                                <button
                                                    onClick={() => setEditingNote(null)}
                                                    style={{
                                                        padding: '6px 10px',
                                                        background: 'transparent', border: '1px solid var(--color-border)',
                                                        borderRadius: 'var(--radius-full)', cursor: 'pointer',
                                                        color: 'var(--color-text)', fontSize: '0.75rem',
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                                <h4 style={{ fontWeight: 500, fontSize: '0.85rem', flex: 1 }}>{note.title}</h4>
                                                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                                                    <button
                                                        onClick={() => { setEditingNote(note._id); setEditTitle(note.title); setEditContent(note.content); }}
                                                        style={{ ...smallIconBtn, color: 'var(--color-text-secondary)' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteNote(note._id)}
                                                        style={{ ...smallIconBtn, color: 'var(--color-danger)' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-soft)'}
                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </div>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                                                {note.content}
                                            </p>
                                            <p style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', marginTop: '6px', opacity: 0.6 }}>
                                                {new Date(note.createdAt).toLocaleDateString()}
                                            </p>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {showVocab && (
                    <div
                        className="animate-slide-in-right"
                        style={{
                            width: isNarrowViewport ? '100%' : '360px',
                            maxWidth: isNarrowViewport ? '100%' : '90vw',
                            position: isNarrowViewport ? 'absolute' : 'relative',
                            right: 0,
                            top: 0,
                            bottom: 0,
                            zIndex: isNarrowViewport ? 60 : 'auto',
                            borderLeft: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                            overflow: 'hidden',
                        }}
                    >
                        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontWeight: 500, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <BookA size={18} style={{ color: 'var(--color-accent)' }} />
                                Vocabulary
                            </h3>
                            <button
                                onClick={() => setShowVocab(false)}
                                style={{ ...smallIconBtn, color: 'var(--color-text-secondary)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
                            <input
                                placeholder="Word"
                                value={vocabWord}
                                onChange={(e) => setVocabWord(e.target.value)}
                                style={{ ...inputStyle, marginBottom: '8px' }}
                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                            />
                            <input
                                placeholder="Definition"
                                value={vocabDef}
                                onChange={(e) => setVocabDef(e.target.value)}
                                style={{ ...inputStyle, marginBottom: '8px' }}
                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                            />
                            <button
                                onClick={handleAddVocab}
                                disabled={!vocabWord.trim() || !vocabDef.trim()}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'var(--color-accent)',
                                    color: '#fff',
                                    fontWeight: 500,
                                    fontSize: '0.8rem',
                                    border: 'none',
                                    cursor: !vocabWord.trim() || !vocabDef.trim() ? 'not-allowed' : 'pointer',
                                    opacity: !vocabWord.trim() || !vocabDef.trim() ? 0.5 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                }}
                            >
                                <Plus size={14} />
                                Add Word
                            </button>
                        </div>

                        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px' }}>
                            {vocab.length === 0 && (
                                <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '24px', fontSize: '0.85rem' }}>
                                    No vocabulary yet. Add words you learn.
                                </p>
                            )}
                            {vocab.map((v, i) => (
                                <div
                                    key={v._id || i}
                                    style={{
                                        padding: '10px 12px',
                                        borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--color-border)',
                                        marginBottom: '6px',
                                        background: 'var(--color-bg)',
                                    }}
                                >
                                    {editingVocab === v._id ? (
                                        <>
                                            <input
                                                value={editVocabWord}
                                                onChange={(e) => setEditVocabWord(e.target.value)}
                                                style={{ ...inputStyle, marginBottom: '6px' }}
                                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                                            />
                                            <input
                                                value={editVocabDef}
                                                onChange={(e) => setEditVocabDef(e.target.value)}
                                                style={{ ...inputStyle, marginBottom: '6px' }}
                                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                                            />
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    onClick={() => handleEditVocab(v._id!)}
                                                    style={{
                                                        flex: 1, padding: '6px',
                                                        background: 'var(--color-accent)', color: '#fff',
                                                        border: 'none', borderRadius: 'var(--radius-full)',
                                                        cursor: 'pointer', fontWeight: 500, fontSize: '0.75rem',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                                                    }}
                                                >
                                                    <Save size={12} /> Save
                                                </button>
                                                <button
                                                    onClick={() => setEditingVocab(null)}
                                                    style={{
                                                        padding: '6px 10px',
                                                        background: 'transparent', border: '1px solid var(--color-border)',
                                                        borderRadius: 'var(--radius-full)', cursor: 'pointer',
                                                        color: 'var(--color-text)', fontSize: '0.75rem',
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <span style={{ fontWeight: 500, fontSize: '0.85rem', color: 'var(--color-accent)' }}>
                                                    {v.word}
                                                </span>
                                                <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
                                                    <button
                                                        onClick={() => { setEditingVocab(v._id!); setEditVocabWord(v.word); setEditVocabDef(v.definition); }}
                                                        style={{ ...smallIconBtn, color: 'var(--color-text-secondary)' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                    >
                                                        <Edit3 size={13} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteVocab(v._id!)}
                                                        style={{ ...smallIconBtn, color: 'var(--color-danger)' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-soft)'}
                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </div>
                                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                                                {v.definition}
                                            </p>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
