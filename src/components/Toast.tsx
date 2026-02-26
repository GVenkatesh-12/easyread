import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => { } });

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = useCallback((message: string, type: ToastType = 'info') => {
        const id = ++toastId;
        setToasts((prev) => [...prev, { id, message, type }]);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div
                style={{
                    position: 'fixed',
                    bottom: '24px',
                    right: '24px',
                    zIndex: 9999,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    maxWidth: '400px',
                }}
            >
                {toasts.map((toast) => (
                    <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
                ))}
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
    useEffect(() => {
        const timer = setTimeout(() => onRemove(toast.id), 4000);
        return () => clearTimeout(timer);
    }, [toast.id, onRemove]);

    const iconMap = {
        success: <CheckCircle size={18} />,
        error: <AlertCircle size={18} />,
        info: <Info size={18} />,
    };

    const colorMap = {
        success: 'var(--color-success)',
        error: 'var(--color-danger)',
        info: 'var(--color-accent)',
    };

    return (
        <div
            className="animate-slide-up"
            style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: 'var(--color-surface)',
                boxShadow: 'var(--shadow-3)',
                borderLeft: `3px solid ${colorMap[toast.type]}`,
            }}
        >
            <span style={{ color: colorMap[toast.type], flexShrink: 0, display: 'flex' }}>{iconMap[toast.type]}</span>
            <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--color-text)' }}>
                {toast.message}
            </span>
            <button
                onClick={() => onRemove(toast.id)}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    padding: '4px',
                    display: 'flex',
                    flexShrink: 0,
                    borderRadius: 'var(--radius-full)',
                }}
            >
                <X size={14} />
            </button>
        </div>
    );
}

export const useToast = () => useContext(ToastContext);
