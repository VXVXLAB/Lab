import { api, buildUrl } from './client';
import type { Voucher, VoucherBody, VoucherHistoryEntry, VoucherPage } from './types';

export interface VoucherListParams {
  type?: 'receipt' | 'payment';
  account_id?: number;
  partner_id?: number;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

export const vouchersApi = {
  list: (p: VoucherListParams, signal?: AbortSignal) => api.get<VoucherPage>('/vouchers', { ...p }, signal),
  get: (id: number) => api.get<Voucher>(`/vouchers/${id}`),
  create: (b: VoucherBody) => api.post<Voucher>('/vouchers', b),
  update: (id: number, b: VoucherBody) => api.put<Voucher>(`/vouchers/${id}`, b),
  remove: (id: number, version?: number) => api.del<{ ok: true; id: number }>(`/vouchers/${id}`, { version }),
  history: (id: number) => api.get<{ items: VoucherHistoryEntry[] }>(`/vouchers/${id}/history`),
  exportUrl: (id: number, format: 'xlsx' | 'docx') => buildUrl(`/vouchers/${id}/export`, { format }),
};
