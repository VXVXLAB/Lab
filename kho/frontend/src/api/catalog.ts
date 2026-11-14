import { api, type QueryParams } from './client';
import type {
  CashAccount,
  CashAccountBody,
  Dashboard,
  ListParams,
  Paged,
  Partner,
  PartnerBody,
  PartnerListParams,
  PriceInfo,
  Product,
  ProductBody,
  ProductGroup,
  ProductGroupBody,
  ProductListParams,
  StockSummary,
  User,
  UserBody,
  Warehouse,
  WarehouseBody,
} from './types';

export interface CatalogResource<T, B, P extends ListParams = ListParams> {
  path: string;
  list: (params: P, signal?: AbortSignal) => Promise<Paged<T>>;
  get: (id: number) => Promise<T>;
  create: (body: B) => Promise<T>;
  update: (id: number, body: B) => Promise<T>;
  remove: (id: number) => Promise<{ ok: true }>;
}

function toQuery(p: object): QueryParams {
  const q: QueryParams = {};
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') q[k] = v;
  }
  return q;
}

function catalogResource<T, B, P extends ListParams = ListParams>(path: string): CatalogResource<T, B, P> {
  return {
    path,
    list: (params, signal) => api.get<Paged<T>>(path, toQuery(params), signal),
    get: (id) => api.get<T>(`${path}/${id}`),
    create: (body) => api.post<T>(path, body),
    update: (id, body) => api.put<T>(`${path}/${id}`, body),
    remove: (id) => api.del<{ ok: true }>(`${path}/${id}`),
  };
}

export const warehousesApi = catalogResource<Warehouse, WarehouseBody>('/warehouses');
export const productGroupsApi = catalogResource<ProductGroup, ProductGroupBody>('/product-groups');
export const productsApi = {
  ...catalogResource<Product, ProductBody, ProductListParams>('/products'),
  lookup: (code: string) => api.get<Product>('/products/lookup', { code }),
  priceInfo: (id: number, date?: string) => api.get<PriceInfo>(`/products/${id}/price-info`, { date }),
};
export const partnersApi = catalogResource<Partner, PartnerBody, PartnerListParams>('/partners');
export const cashAccountsApi = catalogResource<CashAccount, CashAccountBody>('/cash-accounts');

export const usersApi = {
  list: () => api.get<Paged<User>>('/users'),
  create: (body: UserBody) => api.post<User>('/users', body),
  update: (id: number, body: Partial<UserBody>) => api.put<User>(`/users/${id}`, body),
};

export const dashboardApi = {
  get: (lowStockThreshold?: number) =>
    api.get<Dashboard>('/dashboard', { low_stock_threshold: lowStockThreshold }),
};

export const reportsApi = {
  stockSummary: (params: { as_of?: string; warehouse_id?: number; group_id?: number; q?: string; only_with_data?: boolean }) =>
    api.get<StockSummary>('/reports/stock-summary', toQuery(params)),
};
