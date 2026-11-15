// API của bản mở rộng (docs/API.md §8). Chỉ gọi khi tính năng tương ứng đang bật (tắt ⇒ máy chủ trả 404 FEATURE_OFF).
import { api } from './client';
import type { FeatureKey, FeaturesResponse, ImportKind, ImportResult, PeriodLock, Permission, Role, RolePermissions } from './types';

export const featuresApi = {
  get: () => api.get<FeaturesResponse>('/features'),
  set: (features: Partial<Record<FeatureKey, boolean>>, confirm = false) =>
    api.put<FeaturesResponse>('/features', { features, confirm }),
};

export const rolePermissionsApi = {
  get: () => api.get<RolePermissions>('/role-permissions'),
  set: (matrix: Partial<Record<Role, Permission[]>>) => api.put<RolePermissions>('/role-permissions', { matrix }),
};

export const periodLockApi = {
  get: () => api.get<PeriodLock>('/period-lock'),
  set: (lock_date: string | null, reason: string) => api.put<PeriodLock>('/period-lock', { lock_date, reason }),
};

export const importApi = {
  templateUrl: (kind: ImportKind) => `/import/${kind}/template`,
  run: (kind: ImportKind, file: File, opts: { dryRun: boolean; date?: string }, onProgress?: (pct: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<ImportResult>(`/import/${kind}`, form, { dry_run: opts.dryRun ? '1' : undefined, date: opts.date }, onProgress);
  },
};
