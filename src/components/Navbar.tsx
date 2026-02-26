import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import * as api from '../services/api';
import { Sun, Moon, BookOpen, LogOut, ArrowLeft, KeyRound, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface NavbarProps {
    title?: string;
    showBack?: boolean;
    children?: React.ReactNode;
}

export default function Navbar({ title = 'EasyRead', showBack = false, children }: NavbarProps) {
    const { isDark, toggle } = useTheme();
    const { isAuthenticated, logout } = useAuth();
    const { showToast } = useToast();
    const navigate = useNavigate();

    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [changingPassword, setChangingPassword] = useState(false);

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

                {children}

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
