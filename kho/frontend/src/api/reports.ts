import { api, buildUrl, type QueryParams } from './client';
import type { DraftDemandItem, Settings, StockLedger, StockNxt, StockSummary, TradeReport } from './types';

export interface StockSummaryParams { as_of?: string; warehouse_id?: number; group_id?: number; q?: string; only_with_data?: boolean }
export interface NxtParams { from?: string; to?: string; warehouse_id?: number; group_id?: number; q?: string }
export interface LedgerParams { product_id: number; from?: string; to?: string; warehouse_id?: number }
export interface TradeParams {
  from?: string; to?: string; partner_id?: number; product_id?: number; group_id?: number; warehouse_id?: number; q?: string; include_returns?: boolean;
}

const q = (p: object): QueryParams => {
  const out: QueryParams = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  return out;
};

/** Mọi báo cáo: JSON để xem, `xlsxUrl` để tải đúng bộ lọc đang xem. */
export const reportApi = {
  stockSummary: (p: StockSummaryParams) => api.get<StockSummary>('/reports/stock-summary', q(p)),
  stockNxt: (p: NxtParams) => api.get<StockNxt>('/reports/stock-nxt', q(p)),
  stockLedger: (p: LedgerParams) => api.get<StockLedger>('/reports/stock-ledger', q(p)),
  sales: (p: TradeParams) => api.get<TradeReport>('/reports/sales', q(p)),
  purchases: (p: TradeParams) => api.get<TradeReport>('/reports/purchases', q(p)),
  draftDemand: (onlyShortage: boolean) => api.get<{ items: DraftDemandItem[] }>('/reports/draft-demand', { only_shortage: onlyShortage }),
  xlsxUrl: (name: string, p: object) => buildUrl(`/reports/${name}`, { ...q(p), format: 'xlsx' }),
};

export const settingsApi = {
  get: () => api.get<Settings>('/settings'),
  update: (s: Settings) => api.put<Settings>('/settings', s),
};

export const authApi = {
  changePassword: (old_password: string, new_password: string) => api.post<{ ok: true }>('/auth/change-password', { old_password, new_password }),
};
