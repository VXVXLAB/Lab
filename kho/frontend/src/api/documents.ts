import { api, buildUrl } from './client';
import type {
  DocStatus,
  DocumentBody,
  DocumentCheck,
  DocumentFull,
  DocumentHistoryEntry,
  DocumentListParams,
  DocumentSummary,
  Paged,
} from './types';

export const documentsApi = {
  list: (p: DocumentListParams, signal?: AbortSignal) =>
    api.get<Paged<DocumentSummary>>('/documents', { ...p }, signal),
  get: (id: number) => api.get<DocumentFull>(`/documents/${id}`),
  create: (body: DocumentBody) => api.post<DocumentFull>('/documents', body),
  update: (id: number, body: DocumentBody) => api.put<DocumentFull>(`/documents/${id}`, body),
  post: (id: number, version: number, confirmLoss = false) =>
    api.post<DocumentFull>(`/documents/${id}/post`, { version, confirm_loss: confirmLoss }),
  unpost: (id: number, version: number) => api.post<DocumentFull>(`/documents/${id}/unpost`, { version }),
  remove: (id: number, version?: number) => api.del<{ ok: true; id: number }>(`/documents/${id}`, { version }),
  check: (id: number) => api.get<DocumentCheck>(`/documents/${id}/check`),
  history: (id: number) => api.get<{ items: DocumentHistoryEntry[] }>(`/documents/${id}/history`),
  exportUrl: (id: number, format: 'xlsx' | 'docx') => buildUrl(`/documents/${id}/export`, { format }),
};

export type { DocStatus };
