import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import * as api from '../services/api';
import { Sun, Moon, BookOpen, LogOut, ArrowLeft, KeyRound, X, Loader2, Search, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface NavbarProps {
    title?: string;
    showBack?: boolean;
    children?: React.ReactNode;
    onAddVocabFromLookup?: (word: string, definition: string) => Promise<void>;
}

export default function Navbar({ title = 'EasyRead', showBack = false, children, onAddVocabFromLookup }: NavbarProps) {
    const { isDark, toggle } = useTheme();
    const { isAuthenticated, logout } = useAuth();
    const { showToast } = useToast();
    const navigate = useNavigate();

    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [changingPassword, setChangingPassword] = useState(false);
    const [showDictionaryModal, setShowDictionaryModal] = useState(false);
    const [lookupWord, setLookupWord] = useState('');
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupResult, setLookupResult] = useState<{
        word: string;
        definition: string;
        partOfSpeech: string;
    } | null>(null);
    const [lookupError, setLookupError] = useState('');
    const [addingLookupWord, setAddingLookupWord] = useState(false);

    const handleChangePassword = async () => {
        if (!oldPassword || !newPassword) return;
        if (newPassword.length < 8) {
            showToast('New password must be at least 8 characters', 'error');
            return;
        }
        if (oldPassword === newPassword) {
            showToast('New password must be different from old password', 'error');
            return;
        }
        setChangingPassword(true);
        try {
            await api.changePassword(oldPassword, newPassword);
            showToast('Password changed successfully!', 'success');
            setShowPasswordModal(false);
            setOldPassword('');
            setNewPassword('');
        } catch (err: any) {
            showToast(err.message || 'Failed to change password', 'error');
        } finally {
            setChangingPassword(false);
        }
    };

    const resetDictionaryState = () => {
        setLookupWord('');
        setLookupResult(null);
        setLookupError('');
        setLookupLoading(false);
        setAddingLookupWord(false);
    };

    const closeDictionaryModal = () => {
        setShowDictionaryModal(false);
        resetDictionaryState();
    };

    const handleLookupWord = async () => {
        const trimmed = lookupWord.trim();
        if (!trimmed) return;
        setLookupLoading(true);
        setLookupError('');
        setLookupResult(null);
        try {
            const result = await api.lookupWordDefinition(trimmed);
            setLookupResult(result);
        } catch (err: any) {
            setLookupError(err.message || 'Failed to fetch meaning');
        } finally {
            setLookupLoading(false);
        }
    };

    const handleAddLookupWord = async () => {
        if (!lookupResult || !onAddVocabFromLookup) return;
        setAddingLookupWord(true);
        try {
            await onAddVocabFromLookup(lookupResult.word, lookupResult.definition);
            closeDictionaryModal();
        } catch {
            // Reader page handles toast for add failures.
        } finally {
            setAddingLookupWord(false);
        }
    };

    const iconBtn: React.CSSProperties = {
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-full)',
        width: '40px',
        height: '40px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-text-secondary)',
        transition: 'background 0.15s',
    };

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
        <>
            <nav
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 50,
                    padding: '0 16px',
                    height: '56px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'var(--color-surface)',
                    borderBottom: '1px solid var(--color-border)',
                }}
            >
                {showBack && (
                    <button
                        onClick={() => navigate(-1)}
                        style={iconBtn}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        aria-label="Go back"
                    >
                        <ArrowLeft size={20} />
                    </button>
                )}

                {!showBack && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '4px' }}>
                        <BookOpen size={22} style={{ color: 'var(--color-accent)' }} />
                        <span style={{ fontWeight: 600, fontSize: '1.125rem', color: 'var(--color-text)' }}>
                            {title}
                        </span>
                    </div>
                )}

                {showBack && (
                    <span style={{ fontWeight: 500, fontSize: '1rem', color: 'var(--color-text)' }}>
                        {title}
                    </span>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {onAddVocabFromLookup && (
                        <button
                            onClick={() => setShowDictionaryModal(true)}
                            style={iconBtn}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            aria-label="Lookup word meaning"
                        >
                            <Search size={20} />
                        </button>
                    )}

                    {children}
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                        onClick={toggle}
                        style={iconBtn}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        aria-label="Toggle theme"
                    >
                        {isDark ? <Sun size={20} /> : <Moon size={20} />}
                    </button>

                    {isAuthenticated && (
                        <>
                            <button
                                onClick={() => setShowPasswordModal(true)}
                                style={iconBtn}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                aria-label="Change password"
                            >
                                <KeyRound size={20} />
                            </button>
                            <button
                                onClick={() => { logout(); navigate('/login'); }}
                                style={{ ...iconBtn, color: 'var(--color-danger)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-danger-soft)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                aria-label="Logout"
                            >
                                <LogOut size={20} />
                            </button>
                        </>
                    )}
                </div>
            </nav>

            {showDictionaryModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 100,
                        padding: '20px',
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget) closeDictionaryModal(); }}
                >
                    <div
                        className="animate-slide-up"
                        style={{
                            width: '100%',
                            maxWidth: '460px',
                            padding: '24px',
                            borderRadius: 'var(--radius-lg)',
                            background: 'var(--color-surface)',
                            boxShadow: 'var(--shadow-3)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontWeight: 600, fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Search size={20} style={{ color: 'var(--color-accent)' }} />
                                Word Lookup
                            </h3>
                            <button
                                onClick={closeDictionaryModal}
                                style={{ ...iconBtn, width: '32px', height: '32px' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                            <input
                                autoFocus
                                value={lookupWord}
                                onChange={(e) => setLookupWord(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleLookupWord(); }}
                                placeholder="Enter a word"
                                style={inputStyle}
                                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                            />
                            <button
                                onClick={handleLookupWord}
                                disabled={lookupLoading || !lookupWord.trim()}
                                style={{
                                    padding: '0 16px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'var(--color-accent)',
                                    color: '#fff',
                                    border: 'none',
                                    fontWeight: 500,
                                    fontSize: '0.85rem',
                                    cursor: lookupLoading || !lookupWord.trim() ? 'not-allowed' : 'pointer',
                                    opacity: lookupLoading || !lookupWord.trim() ? 0.5 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    minWidth: '100px',
                                }}
                            >
                                {lookupLoading ? (
                                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                ) : (
                                    'Search'
                                )}
                            </button>
                        </div>

                        {lookupError && (
                            <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginBottom: '10px' }}>
                                {lookupError}
                            </p>
                        )}

                        {lookupResult && (
                            <div
                                style={{
                                    border: '1px solid var(--color-border)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '12px',
                                    background: 'var(--color-bg)',
                                }}
                            >
                                <p style={{ fontWeight: 600, color: 'var(--color-accent)', marginBottom: '4px' }}>
                                    {lookupResult.word}
                                    {lookupResult.partOfSpeech ? (
                                        <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: '8px', fontSize: '0.8rem' }}>
                                            {lookupResult.partOfSpeech}
                                        </span>
                                    ) : null}
                                </p>
                                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: '12px' }}>
                                    {lookupResult.definition}
                                </p>
                                {onAddVocabFromLookup && (
                                    <button
                                        onClick={handleAddLookupWord}
                                        disabled={addingLookupWord}
                                        style={{
                                            width: '100%',
                                            padding: '8px',
                                            borderRadius: 'var(--radius-full)',
                                            background: 'var(--color-accent)',
                                            color: '#fff',
                                            fontWeight: 500,
                                            fontSize: '0.8rem',
                                            border: 'none',
                                            cursor: addingLookupWord ? 'not-allowed' : 'pointer',
                                            opacity: addingLookupWord ? 0.6 : 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                        }}
                                    >
                                        {addingLookupWord ? (
                                            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                        ) : (
                                            <Plus size={14} />
                                        )}
                                        Add to Vocab
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {showPasswordModal && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 100,
                        padding: '20px',
                    }}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowPasswordModal(false); }}
                >
                    <div
                        className="animate-slide-up"
                        style={{
                            width: '100%',
                            maxWidth: '400px',
                            padding: '24px',
                            borderRadius: 'var(--radius-lg)',
                            background: 'var(--color-surface)',
                            boxShadow: 'var(--shadow-3)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3 style={{ fontWeight: 600, fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <KeyRound size={20} style={{ color: 'var(--color-accent)' }} />
                                Change Password
                            </h3>
                            <button
                                onClick={() => setShowPasswordModal(false)}
                                style={{ ...iconBtn, width: '32px', height: '32px' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                    Current Password
                                </label>
                                <input
                                    type="password"
                                    value={oldPassword}
                                    onChange={(e) => setOldPassword(e.target.value)}
                                    placeholder="Enter current password"
                                    style={inputStyle}
                                    onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                    onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                                    New Password
                                </label>
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="At least 8 characters"
                                    style={inputStyle}
                                    onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                                    onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                                />
                            </div>
                            <button
                                onClick={handleChangePassword}
                                disabled={changingPassword || !oldPassword || !newPassword}
                                style={{
                                    width: '100%',
                                    padding: '10px 24px',
                                    borderRadius: 'var(--radius-full)',
                                    background: 'var(--color-accent)',
                                    color: '#fff',
                                    fontWeight: 500,
                                    fontSize: '0.875rem',
                                    border: 'none',
                                    cursor: changingPassword || !oldPassword || !newPassword ? 'not-allowed' : 'pointer',
                                    opacity: changingPassword || !oldPassword || !newPassword ? 0.5 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    marginTop: '4px',
                                    transition: 'background 0.15s, opacity 0.15s',
                                }}
                            >
                                {changingPassword ? (
                                    <>
                                        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                        Changing...
                                    </>
                                ) : (
                                    'Change Password'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
