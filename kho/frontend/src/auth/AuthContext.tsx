import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setUnauthorizedHandler } from '../api/client';
import { storage } from '../lib/storage';
import { unsavedStore } from '../lib/unsavedStore';

import type { FeatureKey, Me, Permission, User } from '../api/types';

const HAD_SESSION = 'kho.hadSession';

/** Mọi quyền (bản chuẩn / tính năng phân quyền tắt: ai cũng đủ quyền như hiện nay). */
export const ALL_PERMISSIONS: Permission[] = [
  'sale.write',
  'purchase.write',
  'stock.write',
  'cash.write',
  'catalog.write',
  'posted.edit',
  'cost.view',
  'debt.view',
  'cash.view',
  'report.view',
];

/** Tính năng mở rộng đang bật + quyền của người dùng (từ /auth/me). */
export interface Access {
  features: Partial<Record<FeatureKey, boolean>>;
  permissions: ReadonlySet<Permission>;
}

const accessOf = (me: Me): Access => ({
  features: me.features ?? {},
  permissions: new Set(me.permissions ?? ALL_PERMISSIONS),
});

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' | 'logout' }
  | { status: 'authenticated'; user: User; access: Access };

interface AuthContextValue {
  state: AuthState;
  user: User | null;
  access: Access | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Đọc lại /auth/me (sự kiện "features": quản trị đổi tính năng, ma trận quyền, ngày khóa sổ). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  // Kiểm tra phiên hiện có (cookie 30 ngày).
  useEffect(() => {
    let cancelled = false;
    // Trình duyệt này chưa từng đăng nhập (hoặc đã đăng xuất) ⇒ chắc chắn không có phiên: vào thẳng màn đăng nhập,
    // không gọi /auth/me (tránh lỗi 401 đỏ trong console).
    if (storage.get(HAD_SESSION) !== '1') {
      setState({ status: 'anonymous' });
      return undefined;
    }
    api
      .get<Me>('/auth/me')
      .then((r) => !cancelled && setState({ status: 'authenticated', user: r.user, access: accessOf(r) }))
      .catch(() => {
        if (cancelled) return;
        storage.set(HAD_SESSION, '0');
        setState({ status: 'anonymous' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Bất kỳ lệnh gọi nào nhận 401 ⇒ về màn đăng nhập.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState((s) => (s.status === 'authenticated' ? { status: 'anonymous', reason: 'expired' } : s));
      storage.set(HAD_SESSION, '0');
      unsavedStore.markSessionEnded();
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await api.post<Me>('/auth/login', { username, password }, { skipAuthRedirect: true });
      // lệnh đăng nhập trả luôn tính năng + quyền; máy chủ cũ không trả ⇒ hỏi /auth/me
      const me = r.permissions && r.features ? r : await api.get<Me>('/auth/me').catch(() => r);
      queryClient.clear();
      storage.set(HAD_SESSION, '1');
      setState({ status: 'authenticated', user: me.user, access: accessOf(me) });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    if (state.status === 'authenticated') unsavedStore.clearUser(state.user.id);
    storage.set(HAD_SESSION, '0');
    try {
      await api.post('/auth/logout');
    } catch (e) {
      // Mất mạng khi đăng xuất: vẫn về màn đăng nhập trên máy này.
      if (!(e instanceof ApiError)) throw e;
    }
    queryClient.clear();
    setState({ status: 'anonymous', reason: 'logout' });
  }, [queryClient, state]);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<Me>('/auth/me');
      setState((s) => (s.status === 'authenticated' && s.user.id === me.user.id ? { status: 'authenticated', user: me.user, access: accessOf(me) } : s));
    } catch {
      /* 401 đã được xử lý chung; lỗi mạng: giữ nguyên */
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user: state.status === 'authenticated' ? state.user : null,
      access: state.status === 'authenticated' ? state.access : null,
      login,
      logout,
      refresh,
    }),
    [state, login, logout, refresh],
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

const NO_ACCESS: Access = { features: {}, permissions: new Set(ALL_PERMISSIONS) };

/** Tính năng mở rộng + quyền của người đang đăng nhập. */
export function useAccess(): Access & { can: (p: Permission) => boolean; on: (f: FeatureKey) => boolean; isAdmin: boolean } {
  const { access, user } = useAuth();
  const a = access ?? NO_ACCESS;
  return {
    ...a,
    can: (p) => a.permissions.has(p),
    on: (f) => !!a.features[f],
    isAdmin: user?.role === 'admin',
  };
}

/** Tính năng mở rộng `key` đang bật? (bản chuẩn: luôn false) */
export function useFeature(key: FeatureKey): boolean {
  return !!useAuth().access?.features[key];
}

/** Người dùng có quyền `p`? (tính năng phân quyền tắt: luôn true) */
export function useCan(p: Permission): boolean {
  const a = useAuth().access;
  return a ? a.permissions.has(p) : true;
}
