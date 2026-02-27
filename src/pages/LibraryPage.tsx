import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { useToast } from '../components/Toast';
import * as api from '../services/api';
import type { Book } from '../services/api';
import {
    Plus,
    Upload,
    X,
    Search,
    BookOpen,
    Trash2,
    FileText,
    Loader2,
} from 'lucide-react';

export default function LibraryPage() {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [books, setBooks] = useState<Book[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [showUpload, setShowUpload] = useState(false);
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploading, setUploading] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
    const fileRef = useRef<HTMLInputElement>(null);

    const loadBooks = useCallback(async () => {
        try {
            setLoading(true);
            const data = await api.getBooks();
            setBooks(data);
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Failed to load books', 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadBooks();
    }, [loadBooks]);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!uploadFile) return;
        setUploading(true);
        try {
            const book = await api.uploadBook(uploadFile, uploadTitle || undefined);
            setBooks((prev) => [book, ...prev]);
            setShowUpload(false);
            setUploadFile(null);
            setUploadTitle('');
            showToast('Book uploaded successfully!', 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.deleteBook(id);
            setBooks((prev) => prev.filter((b) => b._id !== id));
            setDeleteConfirm(null);
            showToast('Book deleted', 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
        }
    };

    const filtered = books.filter((b) =>
        b.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '12px 16px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text)',
        fontSize: '0.875rem',
        outline: 'none',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s',
    };

    return (
        <div style={{ minHeight: '100vh' }}>
            <Navbar>
                <div
                    style={{
                        position: 'relative',
                        flex: '1 1 auto',
                        minWidth: 0,
                        maxWidth: '480px',
                        marginLeft: isMobile ? '0' : '4px',
                    }}
                >
                    <Search
                        size={18}
                        style={{
                            position: 'absolute',
                            left: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: 'var(--color-text-secondary)',
                        }}
                    />
                    <input
                        type="text"
                        placeholder={isMobile ? 'Search...' : 'Search books...'}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '8px 12px 8px 40px',
                            background: 'var(--color-bg)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-full)',
                            color: 'var(--color-text)',
                            fontSize: '0.875rem',
                            outline: 'none',
                            transition: 'border-color 0.15s, box-shadow 0.15s',
                            boxSizing: 'border-box',
                        }}
                        onFocus={e => {
                            e.target.style.borderColor = 'var(--color-accent)';
                            e.target.style.boxShadow = '0 0 0 1px var(--color-accent)';
                        }}
                        onBlur={e => {
                            e.target.style.borderColor = 'var(--color-border)';
                            e.target.style.boxShadow = 'none';
                        }}
                    />
                </div>
            </Navbar>

            <main style={{ padding: isMobile ? '16px' : '24px', maxWidth: '1200px', margin: '0 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? '16px' : '24px' }}>
                    <div>
                        <h2 style={{ fontSize: isMobile ? '1.2rem' : '1.375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                            My Library
                        </h2>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '2px' }}>
                            {books.length} {books.length === 1 ? 'book' : 'books'} in your collection
                        </p>
                    </div>
                </div>

                {loading && (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
                        <Loader2 size={36} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />
                    </div>
                )}

                {!loading && books.length === 0 && (
                    <div className="animate-fade-in" style={{ textAlign: 'center', padding: '80px 20px' }}>
                        <div
                            style={{
                                width: '72px',
                                height: '72px',
                                borderRadius: 'var(--radius-full)',
                                background: 'var(--color-accent-soft)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 20px',
                            }}
                        >
                            <BookOpen size={32} style={{ color: 'var(--color-accent)' }} />
                        </div>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '8px' }}>
                            Your library is empty
                        </h3>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', maxWidth: '360px', margin: '0 auto 24px' }}>
                            Upload your first PDF book and start reading.
                        </p>
                        <button
                            onClick={() => setShowUpload(true)}
                            style={{
                                padding: '10px 24px',
                                borderRadius: 'var(--radius-full)',
                                background: 'var(--color-accent)',
                                color: '#fff',
                                fontWeight: 500,
                                fontSize: '0.875rem',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px',
                            }}
                        >
                            <Upload size={18} />
                            Upload Book
                        </button>
                    </div>
                )}

                {!loading && filtered.length > 0 && (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 220 : 260}px, 1fr))`,
                            gap: '16px',
                        }}
                    >
                        {filtered.map((book) => (
                            <div
                                key={book._id}
                                style={{
                                    background: 'var(--color-surface)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    overflow: 'hidden',
                                    transition: 'box-shadow 0.15s',
                                    cursor: 'pointer',
                                }}
                                onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-2)'}
                                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                            >
                                <div
                                    onClick={() => navigate(`/read/${book._id}`)}
                                    style={{
                                        height: '140px',
                                        background: `hsl(${(book.title.charCodeAt(0) * 37) % 360}, 40%, 55%)`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        position: 'relative',
                                    }}
                                >
                                    <FileText size={40} color="rgba(255,255,255,0.7)" />
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: '10px',
                                            right: '10px',
                                            background: 'rgba(0,0,0,0.45)',
                                            borderRadius: 'var(--radius-full)',
                                            padding: '3px 10px',
                                            fontSize: '0.75rem',
                                            fontWeight: 500,
                                            color: 'white',
                                        }}
                                    >
                                        {Math.round(book.progressPercentage)}%
                                    </div>
                                </div>

                                <div style={{ padding: '14px 16px' }}>
                                    <h3
                                        onClick={() => navigate(`/read/${book._id}`)}
                                        style={{
                                            fontSize: '0.875rem',
                                            fontWeight: 500,
                                            marginBottom: '8px',
                                            color: 'var(--color-text)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {book.title}
                                    </h3>

                                    <div
                                        style={{
                                            height: '4px',
                                            background: 'var(--color-border)',
                                            borderRadius: 'var(--radius-full)',
                                            marginBottom: '10px',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: '100%',
                                                width: `${book.progressPercentage}%`,
                                                background: 'var(--color-accent)',
                                                borderRadius: 'var(--radius-full)',
                                                transition: 'width 0.5s ease',
                                            }}
                                        />
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                                        <span>Page {book.currentPage} / {book.totalPages}</span>
                                        {book.vocabulary.length > 0 && (
                                            <span
                                                style={{
                                                    background: 'var(--color-accent-soft)',
                                                    color: 'var(--color-accent)',
                                                    padding: '2px 8px',
                                                    borderRadius: 'var(--radius-full)',
                                                    fontSize: '0.7rem',
                                                    fontWeight: 500,
                                                }}
                                            >
                                                {book.vocabulary.length} vocab
                                            </span>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                        <button
                                            onClick={() => navigate(`/read/${book._id}`)}
                                            style={{
                                                flex: 1,
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-full)',
                                                background: 'var(--color-accent)',
                                                color: '#fff',
                                                fontWeight: 500,
                                                fontSize: '0.8rem',
                                                border: 'none',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '6px',
                                            }}
                                        >
                                            <BookOpen size={14} />
                                            Read
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDeleteConfirm(book._id); }}
                                            style={{
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-full)',
                                                background: 'transparent',
                                                border: '1px solid var(--color-border)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                color: 'var(--color-danger)',
                                                transition: 'background 0.15s',
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-soft)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {!loading && books.length > 0 && filtered.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                        <Search size={36} style={{ color: 'var(--color-text-secondary)', marginBottom: '16px' }} />
                        <p style={{ color: 'var(--color-text-secondary)' }}>
                            No books match "{searchQuery}"
                        </p>
                    </div>
                )}
            </main>

            {!loading && books.length > 0 && (
                <button
                    onClick={() => setShowUpload(true)}
                    style={{
                        position: 'fixed',
                        bottom: isMobile ? '16px' : '24px',
                        right: isMobile ? '16px' : '24px',
                        width: isMobile ? '52px' : '56px',
                        height: isMobile ? '52px' : '56px',
                        borderRadius: 'var(--radius-full)',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        background: 'var(--color-accent)',
                        zIndex: 40,
                        boxShadow: 'var(--shadow-3)',
                        transition: 'box-shadow 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 6px 12px 4px rgba(60,64,67,0.2), 0 2px 4px rgba(60,64,67,0.3)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow-3)'}
                    aria-label="Upload book"
                >
                    <Plus size={24} />
                </button>
            )}

            {showUpload && (
                <div
                    className="animate-fade-in"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 100,
                        padding: isMobile ? '12px' : '20px',
                    }}
                    onClick={() => !uploading && setShowUpload(false)}
                >
                    <div
                        className="animate-slide-up"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--color-surface)',
                            borderRadius: 'var(--radius-lg)',
                            padding: isMobile ? '20px' : '28px',
                            width: '100%',
                            maxWidth: '440px',
                            maxHeight: 'calc(100vh - 24px)',
                            overflowY: 'auto',
                            boxShadow: 'var(--shadow-3)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Upload Book</h2>
                            <button
                                onClick={() => setShowUpload(false)}
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--color-text-secondary)',
                                    padding: '4px',
                                    display: 'flex',
                                    borderRadius: 'var(--radius-full)',
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleUpload} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div
                                onClick={() => fileRef.current?.click()}
                                style={{
                                    border: `2px dashed ${uploadFile ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                    borderRadius: 'var(--radius-md)',
                                    padding: '32px 20px',
                                    textAlign: 'center',
                                    cursor: 'pointer',
                                    transition: 'border-color 0.15s, background 0.15s',
                                    background: uploadFile ? 'var(--color-accent-soft)' : 'transparent',
                                }}
                            >
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".pdf"
                                    style={{ display: 'none' }}
                                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                                />
                                {uploadFile ? (
                                    <>
                                        <FileText size={28} style={{ color: 'var(--color-accent)', marginBottom: '8px' }} />
                                        <p style={{ fontWeight: 500, color: 'var(--color-text)' }}>{uploadFile.name}</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                                            {(uploadFile.size / 1024 / 1024).toFixed(1)} MB
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <Upload size={28} style={{ color: 'var(--color-text-secondary)', marginBottom: '8px' }} />
                                        <p style={{ fontWeight: 500, color: 'var(--color-text)' }}>Click to select a PDF</p>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Max 15 MB</p>
                                    </>
                                )}
                            </div>

                            <input
                                type="text"
                                placeholder="Book title (optional)"
                                value={uploadTitle}
                                onChange={(e) => setUploadTitle(e.target.value)}
                                style={inputStyle}
                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                            />

                            <button
                                type="submit"
                                disabled={!uploadFile || uploading}
                                style={{
                                    padding: '10px 24px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'var(--color-accent)',
                                    color: '#fff',
                                    fontWeight: 500,
                                    fontSize: '0.875rem',
                                    border: 'none',
                                    cursor: !uploadFile || uploading ? 'not-allowed' : 'pointer',
                                    opacity: !uploadFile || uploading ? 0.5 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    transition: 'opacity 0.15s',
                                }}
                            >
                                {uploading ? (
                                    <>
                                        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload size={18} />
                                        Upload
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {deleteConfirm && (
                <div
                    className="animate-fade-in"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 100,
                        padding: isMobile ? '12px' : '20px',
                    }}
                    onClick={() => setDeleteConfirm(null)}
                >
                    <div
                        className="animate-slide-up"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--color-surface)',
                            borderRadius: 'var(--radius-lg)',
                            padding: isMobile ? '20px' : '28px',
                            maxWidth: '360px',
                            width: '100%',
                            maxHeight: 'calc(100vh - 24px)',
                            overflowY: 'auto',
                            boxShadow: 'var(--shadow-3)',
                            textAlign: 'center',
                        }}
                    >
                        <div
                            style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: 'var(--radius-full)',
                                background: 'var(--color-danger-soft)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 16px',
                            }}
                        >
                            <Trash2 size={22} style={{ color: 'var(--color-danger)' }} />
                        </div>
                        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '8px' }}>
                            Delete Book?
                        </h3>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginBottom: '24px' }}>
                            This will permanently delete the book and all its notes and vocabulary.
                        </p>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'transparent',
                                    border: '1px solid var(--color-border)',
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                    color: 'var(--color-text)',
                                    fontSize: '0.875rem',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                style={{
                                    flex: 1,
                                    padding: '10px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'var(--color-danger)',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 500,
                                    color: 'white',
                                    fontSize: '0.875rem',
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
