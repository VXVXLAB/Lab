import { useMemo, useState } from 'react';
import { Select } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../api/catalog';
import { qk } from '../api/queryKeys';
import { useDebounced } from '../lib/useDebounced';
import { useSearchEnterGuard } from '../lib/searchGuard';

export interface ProductPick {
  id: number;
  code: string;
  name: string;
  unit?: string;
}

/** Chọn một mặt hàng (tìm theo mã/tên, không dấu). */
export function ProductSelect({
  value,
  onChange,
  placeholder = 'Chọn mặt hàng…',
  width = 260,
  goodsOnly = false,
  allowClear = true,
  autoFocus,
  id,
}: {
  value: ProductPick | null;
  onChange: (p: ProductPick | null) => void;
  placeholder?: string;
  width?: number | string;
  goodsOnly?: boolean;
  allowClear?: boolean;
  autoFocus?: boolean;
  id?: string;
}) {
  const [s, setS] = useState('');
  const dq = useDebounced(s.trim(), 150);
  const params = useMemo(() => ({ q: dq || undefined, page_size: 30, is_service: goodsOnly ? false : undefined }), [dq, goodsOnly]);
  const q = useQuery({ queryKey: qk.catalogList('product', params), queryFn: () => productsApi.list(params), staleTime: 30_000 });
  const items: ProductPick[] = q.data?.items ?? [];
  const stale = s.trim() !== dq || q.isFetching || !q.data;
  const guard = useSearchEnterGuard(stale && s.trim() !== '', () => {
    const first = items[0];
    if (!first) return false;
    onChange(first);
    return true;
  });
  const merged = value && !items.some((p) => p.id === value.id) ? [value, ...items] : items;
  return (
    <div ref={guard.wrapRef} className="search-guard" data-search-pending={guard.pendingAttr} onKeyDownCapture={guard.onKeyDownCapture} style={{ display: 'inline-block', width }}>
    <Select<number>
      id={id}
      allowClear={allowClear}
      showSearch
      autoFocus={autoFocus}
      filterOption={false}
      onSearch={setS}
      value={value?.id}
      onChange={(v) => onChange(merged.find((p) => p.id === v) ?? null)}
      placeholder={placeholder}
      style={{ width: '100%' }}
      popupMatchSelectWidth={460}
      loading={q.isFetching}
      notFoundContent={q.isFetching ? 'Đang tìm…' : 'Không có mặt hàng nào'}
      options={merged.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }))}
      defaultActiveFirstOption={!stale}
    />
    </div>
  );
}
