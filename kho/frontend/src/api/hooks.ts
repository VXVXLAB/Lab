// Truy vấn dùng chung giữa nhiều màn (danh sách kho, nhóm hàng, thông tin công ty).
import { useQuery } from '@tanstack/react-query';
import { productGroupsApi, warehousesApi } from './catalog';
import { qk } from './queryKeys';
import { settingsApi } from './reports';

export function useWarehouses() {
  return useQuery({
    queryKey: qk.catalogList('warehouse', { all: true }),
    queryFn: () => warehousesApi.list({ page_size: 1000 }),
    staleTime: 60_000,
  });
}

export function useAllGroups() {
  return useQuery({
    queryKey: qk.catalogList('product_group', { all: true }),
    queryFn: () => productGroupsApi.list({ page_size: 1000 }),
    staleTime: 60_000,
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.catalog('settings'), queryFn: () => settingsApi.get(), staleTime: 5 * 60_000 });
}
