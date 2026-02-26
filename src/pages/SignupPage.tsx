import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useToast } from '../components/Toast';
import { Link, Navigate } from 'react-router-dom';
import { BookOpen, Mail, Lock, Sun, Moon, Eye, EyeOff, Loader2 } from 'lucide-react';

export default function SignupPage() {
    const { signup, isAuthenticated } = useAuth();
    const { isDark, toggle } = useTheme();
    const { showToast } = useToast();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    if (isAuthenticated) return <Navigate to="/" replace />;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            showToast('Passwords do not match', 'error');
            return;
        }
        if (password.length < 8) {
            showToast('Password must be at least 8 characters', 'error');
            return;
        }
        setLoading(true);
        try {
            await signup(email, password);
            showToast('Account created! Welcome to EasyRead!', 'success');
        } catch (err) {
            showToast(err instanceof Error ? err.message : 'Signup failed', 'error');
        } finally {
            setLoading(false);
        }
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '12px 16px 12px 44px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text)',
        fontSize: '0.875rem',
        outline: 'none',
        transition: 'border-color 0.15s',
        boxSizing: 'border-box' as const,
    };

    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '20px',
                background: 'var(--color-bg)',
            }}
        >
            <button
                onClick={toggle}
                style={{
                    position: 'absolute',
                    top: '16px',
                    right: '16px',
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
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-surface-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                aria-label="Toggle theme"
            >
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <div
                className="animate-fade-in"
                style={{
                    width: '100%',
                    maxWidth: '400px',
                    background: 'var(--color-surface)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '40px 32px',
                    boxShadow: 'var(--shadow-2)',
                    border: '1px solid var(--color-border)',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}>
                    <div
                        style={{
                            width: '48px',
                            height: '48px',
                            borderRadius: 'var(--radius-full)',
                            background: 'var(--color-accent-soft)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '16px',
                        }}
                    >
                        <BookOpen size={24} style={{ color: 'var(--color-accent)' }} />
                    </div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px' }}>
                        Create account
                    </h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                        Start your reading journey
                    </p>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ position: 'relative' }}>
                        <Mail
                            size={18}
                            style={{
                                position: 'absolute',
                                left: '14px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-secondary)',
                            }}
                        />
                        <input
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            style={inputStyle}
                            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                        />
                    </div>

                    <div style={{ position: 'relative' }}>
                        <Lock
                            size={18}
                            style={{
                                position: 'absolute',
                                left: '14px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-secondary)',
                            }}
                        />
                        <input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="Password (min 8 characters)"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                            style={{ ...inputStyle, paddingRight: '44px' }}
                            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            style={{
                                position: 'absolute',
                                right: '8px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--color-text-secondary)',
                                display: 'flex',
                                padding: '4px',
                                borderRadius: 'var(--radius-full)',
                            }}
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                        <Lock
                            size={18}
                            style={{
                                position: 'absolute',
                                left: '14px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                color: 'var(--color-text-secondary)',
                            }}
                        />
                        <input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="Confirm password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            style={inputStyle}
                            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                            onBlur={e => e.target.style.borderColor = 'var(--color-border)'}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            padding: '10px 24px',
                            borderRadius: 'var(--radius-full)',
                            background: 'var(--color-accent)',
                            color: '#fff',
                            fontWeight: 500,
                            fontSize: '0.875rem',
                            border: 'none',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.6 : 1,
                            transition: 'background 0.15s, opacity 0.15s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            marginTop: '4px',
                        }}
                    >
                        {loading ? (
                            <>
                                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                Creating account...
                            </>
                        ) : (
                            'Create Account'
                        )}
                    </button>
                </form>

                <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ color: 'var(--color-accent)', textDecoration: 'none', fontWeight: 500 }}>
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    );
}
