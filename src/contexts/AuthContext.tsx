import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    type ReactNode,
} from 'react';
import * as api from '../services/api';

interface AuthState {
    token: string | null;
    userId: string | null;
    isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string) => Promise<void>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>(() => {
        const token = localStorage.getItem('easyread_token');
        const userId = localStorage.getItem('easyread_userId');
        return {
            token,
            userId,
            isAuthenticated: !!token,
        };
    });

    const logout = useCallback(() => {
        localStorage.removeItem('easyread_token');
        localStorage.removeItem('easyread_userId');
        setState({ token: null, userId: null, isAuthenticated: false });
    }, []);

    const loginAction = useCallback(async (email: string, password: string) => {
        const { token, userId } = await api.login(email, password);
        localStorage.setItem('easyread_token', token);
        localStorage.setItem('easyread_userId', userId);
        setState({ token, userId, isAuthenticated: true });
    }, []);

    const signupAction = useCallback(async (email: string, password: string) => {
        await api.signup(email, password);
        // Auto-login after signup
        await loginAction(email, password);
    }, [loginAction]);

    useEffect(() => {
        const handleSessionExpired = () => logout();
        window.addEventListener('session-expired', handleSessionExpired);
        return () => window.removeEventListener('session-expired', handleSessionExpired);
    }, [logout]);

    return (
        <AuthContext.Provider
            value={{
                ...state,
                login: loginAction,
                signup: signupAction,
                logout,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
