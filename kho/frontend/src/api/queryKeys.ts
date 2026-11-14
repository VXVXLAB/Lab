import type { CatalogEntity } from './types';

// Khóa cache TanStack Query. Quy ước: phần tử đầu là "miền" để SSE invalidate theo tiền tố.
//   ['catalog', <entity>, ...]   danh mục (kể cả 'user')
//   ['price-info', productId, date]
//   ['documents', ...]  ['document', id]   chứng từ kho
//   ['vouchers', ...]   ['voucher', id]    phiếu thu chi
//   ['reports', <tên>, ...]               báo cáo
//   ['dashboard']
export const qk = {
  me: ['auth', 'me'] as const,
  catalog: (entity: CatalogEntity) => ['catalog', entity] as const,
  catalogList: (entity: CatalogEntity, params: object) => ['catalog', entity, 'list', params] as const,
  catalogItem: (entity: CatalogEntity, id: number) => ['catalog', entity, 'item', id] as const,
  priceInfo: (productId: number, date?: string) => ['price-info', productId, date ?? 'today'] as const,
  dashboard: ['dashboard'] as const,
  documents: ['documents'] as const,
  document: (id: number) => ['document', id] as const,
  vouchers: ['vouchers'] as const,
  voucher: (id: number) => ['voucher', id] as const,
  reports: ['reports'] as const,
  report: (name: string, params?: object) => (params ? ['reports', name, params] : ['reports', name]) as readonly unknown[],
};
