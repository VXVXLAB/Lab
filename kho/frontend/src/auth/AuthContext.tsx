import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' | 'logout' }
  | { status: 'authenticated'; user: User };

interface AuthContextValue {
  state: AuthState;
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  // Kiểm tra phiên hiện có (cookie 30 ngày).
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ user: User }>('/auth/me')
      .then((r) => !cancelled && setState({ status: 'authenticated', user: r.user }))
      .catch(() => !cancelled && setState({ status: 'anonymous' }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Bất kỳ lệnh gọi nào nhận 401 ⇒ về màn đăng nhập.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((s) => (s.status === 'authenticated' ? { status: 'anonymous', reason: 'expired' } : s));
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await api.post<{ user: User }>('/auth/login', { username, password }, { skipAuthRedirect: true });
      queryClient.clear();
      setState({ status: 'authenticated', user: r.user });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // Mất mạng khi đăng xuất: vẫn về màn đăng nhập trên máy này.
      if (!(e instanceof ApiError)) throw e;
    }
    queryClient.clear();
    setState({ status: 'anonymous', reason: 'logout' });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, user: state.status === 'authenticated' ? state.user : null, login, logout }),
    [state, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth phải nằm trong AuthProvider');
  return ctx;
}

/** Người dùng hiện tại (chỉ gọi trong phần đã đăng nhập). */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Chưa đăng nhập');
  return user;
}
