// API của bản mở rộng (docs/API.md §8). Chỉ gọi khi tính năng tương ứng đang bật (tắt ⇒ máy chủ trả 404 FEATURE_OFF).
import { api, buildUrl } from './client';
import type { AuditEntry, PrintTemplate, PrintTemplateResponse, ProductUnit, StocktakeLoad, VatSummary, DebtAging, LowStockItem, PartnerPrice, ProfitGroup, ProfitReport, SalePriceItem, FeatureKey, FeaturesResponse, ImportKind, ImportResult, PeriodLock, Permission, Role, RolePermissions } from './types';

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
  templateUrl: (kind: ImportKind) => buildUrl(`/import/${kind}/template`),
  run: (kind: ImportKind, file: File, opts: { dryRun: boolean; date?: string }, onProgress?: (pct: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<ImportResult>(`/import/${kind}`, form, { dry_run: opts.dryRun ? '1' : undefined, date: opts.date }, onProgress);
  },
};

// ---------- Đợt M2 ----------
export const minStockApi = {
  lowStock: () => api.get<{ items: LowStockItem[] }>('/reports/low-stock'),
  lowStockXlsx: () => buildUrl('/reports/low-stock', { format: 'xlsx' }),
};

export const priceListApi = {
  list: (partnerId: number) => api.get<{ partner_id: number; items: PartnerPrice[] }>(`/partners/${partnerId}/prices`),
  /** Thêm / sửa từng mã (không xóa mã khác) */
  upsert: (partnerId: number, items: { product_id: number; price: number; note?: string | null }[]) =>
    api.put<{ partner_id: number; items: PartnerPrice[] }>(`/partners/${partnerId}/prices`, { items, replace: false }),
  remove: (partnerId: number, productId: number) => api.del<{ ok: true }>(`/partners/${partnerId}/prices/${productId}`),
  /** Giá tự điền cho phiếu bán (giá riêng → giá lần trước → giá mặc định) */
  salePrice: (partnerId: number, ids: number[], date?: string) =>
    api.get<{ partner_id: number; date: string; items: SalePriceItem[] }>('/products/sale-price', { partner_id: partnerId, ids: ids.join(','), date }),
};

export interface AgingParams {
  as_of?: string;
  partner_id?: number;
  q?: string;
}
export interface ProfitParams {
  from?: string;
  to?: string;
  group_by: ProfitGroup;
  partner_id?: number;
  product_id?: number;
}
const clean = (p: object) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Record<string, string | number>;
export const extReportsApi = {
  debtAging: (p: AgingParams) => api.get<DebtAging>('/reports/debt-aging', clean(p)),
  debtAgingXlsx: (p: AgingParams) => buildUrl('/reports/debt-aging', { ...clean(p), format: 'xlsx' }),
  profit: (p: ProfitParams) => api.get<ProfitReport>('/reports/profit', clean(p)),
  profitXlsx: (p: ProfitParams) => buildUrl('/reports/profit', { ...clean(p), format: 'xlsx' }),
};

// ---------- Đợt M3 ----------
export const stocktakeApi = {
  /** Mọi mã có tồn ≠ 0 tại kho cuối ngày (nút "Nạp toàn bộ mã đang có tồn") */
  load: (warehouseId: number, date: string) => api.get<StocktakeLoad>('/documents/stocktake-load', { warehouse_id: warehouseId, date }),
};

export const unitsApi = {
  get: (productId: number) => api.get<{ product_id: number; base_unit: string; items: ProductUnit[] }>(`/products/${productId}/units`),
  set: (productId: number, items: { unit: string; factor: number }[]) =>
    api.put<{ product_id: number; base_unit: string; items: ProductUnit[] }>(`/products/${productId}/units`, { items }),
};

export const vatApi = {
  getDefault: () => api.get<{ codes: string[]; default_vat_rate: string | null }>('/settings/vat'),
  setDefault: (code: string | null) => api.put<{ codes: string[]; default_vat_rate: string | null }>('/settings/vat', { default_vat_rate: code }),
  summary: (p: { from?: string; to?: string }) => api.get<VatSummary>('/reports/vat-summary', clean(p)),
  summaryXlsx: (p: { from?: string; to?: string }) => buildUrl('/reports/vat-summary', { ...clean(p), format: 'xlsx' }),
};

export const printTemplateApi = {
  get: () => api.get<PrintTemplateResponse>('/print-template'),
  set: (t: Omit<PrintTemplate, 'has_logo' | 'logo_type' | 'logo_updated_at'>) => api.put<PrintTemplateResponse>('/print-template', t),
  logoUrl: (v?: string | null) => buildUrl('/print-template/logo', v ? { v } : undefined),
  uploadLogo: (file: File) => {
    const f = new FormData();
    f.append('file', file);
    return api.upload<unknown>('/print-template/logo', f);
  },
  removeLogo: () => api.del<unknown>('/print-template/logo'),
};

export interface AuditParams {
  entity?: string;
  user_id?: number;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
export const auditApi = {
  list: (p: AuditParams) => api.get<{ items: AuditEntry[]; total: number; limit: number; offset: number }>('/audit', clean(p)),
};
