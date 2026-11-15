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

const optLabel = (p: ProductPick) => `${p.code} – ${p.name}`;

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
  // Danh sách mở / đóng do ô này quyết định: chọn xong là đóng hẳn, không tự mở lại khi danh mục đầy đủ tải về (F-17)
  const [open, setOpen] = useState(false);
  const dq = useDebounced(s.trim(), 150);
  const params = useMemo(() => ({ q: dq || undefined, page_size: 30, is_service: goodsOnly ? false : undefined }), [dq, goodsOnly]);
  const q = useQuery({ queryKey: qk.catalogList('product', params), queryFn: () => productsApi.list(params), staleTime: 30_000 });
  const items: ProductPick[] = q.data?.items ?? [];
  const stale = s.trim() !== dq || q.isFetching || !q.data;
  const typing = s.trim() !== '';
  const guard = useSearchEnterGuard(typing, stale, (activeTitle) => {
    const p = (activeTitle && items.find((x) => optLabel(x) === activeTitle)) || items[0];
    if (!p) return false; // không có kết quả: giữ chữ đã gõ
    onChange(p);
    setS('');
    setOpen(false);
    return true;
  });
  // Đang gõ tìm ⇒ chỉ hiện kết quả của chữ đang gõ (không ghim mục đang chọn — F-11)
  const merged = !typing && value && !items.some((p) => p.id === value.id) ? [value, ...items] : items;
  return (
    <div ref={guard.wrapRef} className="search-guard" data-search-pending={guard.pendingAttr} data-search-owner={guard.ownerAttr} onKeyDownCapture={guard.onKeyDownCapture} style={{ display: 'inline-block', width }}>
    <Select<number>
      id={id}
      allowClear={allowClear}
      showSearch
      autoFocus={autoFocus}
      filterOption={false}
      searchValue={s}
      onSearch={(v) => {
        setS(v);
        if (v) setOpen(true);
      }}
      open={open}
      onDropdownVisibleChange={setOpen}
      value={value?.id}
      onChange={(v) => {
        onChange(merged.find((p) => p.id === v) ?? null);
        setS('');
        setOpen(false);
      }}
      placeholder={placeholder}
      style={{ width: '100%' }}
      popupMatchSelectWidth={460}
      loading={q.isFetching}
      notFoundContent={q.isFetching ? 'Đang tìm…' : 'Không có mặt hàng nào'}
      options={merged.map((p) => ({ value: p.id, label: optLabel(p), title: optLabel(p) }))}
      defaultActiveFirstOption={!stale}
    />
    </div>
  );
}
