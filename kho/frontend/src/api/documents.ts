import { api, buildUrl } from './client';
import type {
  DocStatus,
  DocumentBody,
  DocumentCheck,
  DocumentFull,
  DocumentHistoryEntry,
  DocumentListParams,
  DocumentPage,
} from './types';

export const documentsApi = {
  list: (p: DocumentListParams, signal?: AbortSignal) =>
    api.get<DocumentPage>('/documents', { ...p }, signal),
  get: (id: number) => api.get<DocumentFull>(`/documents/${id}`),
  create: (body: DocumentBody) => api.post<DocumentFull>('/documents', body),
  update: (id: number, body: DocumentBody) => api.put<DocumentFull>(`/documents/${id}`, body),
  /** `confirmCredit` (bản mở rộng, hạn mức nợ): chỉ gửi khi đã xác nhận vượt hạn mức */
  post: (id: number, version: number, confirmLoss = false, confirmCredit = false) =>
    api.post<DocumentFull>(`/documents/${id}/post`, { version, confirm_loss: confirmLoss, ...(confirmCredit ? { confirm_credit: true } : {}) }),
  unpost: (id: number, version: number) => api.post<DocumentFull>(`/documents/${id}/unpost`, { version }),
  remove: (id: number, version?: number) => api.del<{ ok: true; id: number }>(`/documents/${id}`, { version }),
  check: (id: number) => api.get<DocumentCheck>(`/documents/${id}/check`),
  /** Kiểm tra phiếu đang gõ (chưa lưu); `id` khi đang sửa phiếu có sẵn. */
  checkDraft: (body: DocumentBody & { id?: number }, signal?: AbortSignal) =>
    api.post<DocumentCheck>('/documents/check', body, { signal }),
  history: (id: number) => api.get<{ items: DocumentHistoryEntry[] }>(`/documents/${id}/history`),
  exportUrl: (id: number, format: 'xlsx' | 'docx') => buildUrl(`/documents/${id}/export`, { format }),
};

export type { DocStatus };
