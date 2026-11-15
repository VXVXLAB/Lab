import { useCan } from '../../auth/AuthContext';
import { forwardRef, useMemo, useState } from 'react';
import { Button, Select, Space, Tooltip, type RefSelectProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { partnersApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import type { Partner, PartnerType } from '../../api/types';
import { useDebounced } from '../../lib/useDebounced';
import { PartnerFormModal } from '../catalog/PartnersPage';
import { useSearchEnterGuard } from '../../lib/searchGuard';

export interface PartnerLite {
  id: number;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  is_customer?: boolean;
  is_supplier?: boolean;
}

interface Props {
  /** Bỏ trống = mọi đối tác (bộ lọc danh sách) */
  type?: PartnerType;
  value?: number | null;
  /** Đối tác đang chọn (để hiển thị khi chưa tải danh sách) */
  current?: PartnerLite | null;
  onChange?: (p: PartnerLite | null) => void;
  id?: string;
  disabled?: boolean;
  status?: 'error';
  /** Ẩn nút thêm mới (dùng làm bộ lọc) */
  noAdd?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  style?: React.CSSProperties;
}

const optTitle = (p: PartnerLite) => `${p.code} – ${p.name}`;

/** Ô chọn khách hàng / nhà cung cấp: gõ mã, tên, điện thoại (không dấu được); thêm mới ngay tại chỗ. */
export const PartnerSelect = forwardRef<RefSelectProps, Props>(function PartnerSelect(
  { type, value, current, onChange, id, disabled, status, noAdd: noAddProp, allowClear, placeholder, style },
  ref,
) {
  // bản mở rộng: không có quyền "Sửa danh mục" ⇒ không thêm đối tác tại chỗ (F4)
  const noAdd = noAddProp || !useCan('catalog.write');
  const [search, setSearch] = useState('');
  // Danh sách mở / đóng do ô này quyết định: chọn xong là đóng hẳn (F-17)
  const [open, setOpen] = useState(false);
  const dq = useDebounced(search.trim(), 150);
  const [adding, setAdding] = useState(false);
  const params = useMemo(() => ({ q: dq || undefined, type, active: true, page_size: 30 }), [dq, type]);
  const q = useQuery({
    queryKey: qk.catalogList('partner', params),
    queryFn: () => partnersApi.list(params),
    staleTime: 30_000,
  });
  const items: PartnerLite[] = q.data?.items ?? [];
  // Kết quả đang hiện có phải của đúng chữ đang gõ không (F-05): chờ gõ xong / đang hỏi máy chủ ⇒ chưa được chọn.
  const stale = search.trim() !== dq || q.isFetching || !q.data;
  const typing = search.trim() !== '';
  const guard = useSearchEnterGuard(typing, stale, (activeTitle) => {
    const p = (activeTitle && items.find((x) => optTitle(x) === activeTitle)) || items[0];
    if (!p) return false; // không có kết quả: giữ chữ đã gõ
    onChange?.(p);
    setSearch('');
    setOpen(false);
    return true;
  });
  // Đang gõ tìm ⇒ chỉ hiện kết quả của chữ đang gõ (không ghim mục đang chọn lên đầu — F-11)
  const merged = !typing && current && !items.some((p) => p.id === current.id) ? [current, ...items] : items;
  const label = type === 'customer' ? 'khách hàng' : type === 'supplier' ? 'nhà cung cấp' : 'đối tác';

  return (
    <div
      ref={guard.wrapRef}
      className="search-guard"
      data-search-pending={guard.pendingAttr}
      data-search-owner={guard.ownerAttr}
      onKeyDownCapture={guard.onKeyDownCapture} style={style ?? { width: '100%' }}>
    <Space.Compact style={{ width: '100%' }}>
      <Select<number>
        ref={ref}
        id={id}
        showSearch
        disabled={disabled}
        status={status}
        value={value ?? undefined}
        placeholder={placeholder ?? `Gõ mã, tên hoặc số điện thoại ${label}`}
        allowClear={allowClear}
        onClear={() => onChange?.(null)}
        filterOption={false}
        searchValue={search}
        onSearch={(v) => {
          setSearch(v);
          if (v) setOpen(true);
        }}
        open={open}
        onDropdownVisibleChange={setOpen}
        onKeyDown={(e) => {
          if (e.key === 'F4' && !noAdd && type) {
            e.preventDefault();
            setAdding(true);
          }
        }}
        loading={q.isFetching}
        defaultActiveFirstOption={!stale}
        onChange={(v) => {
          const p = merged.find((x) => x.id === v) ?? null;
          onChange?.(p);
          setSearch('');
          setOpen(false);
        }}
        optionLabelProp="label"
        popupMatchSelectWidth={520}
        notFoundContent={
          q.isFetching ? (
            'Đang tìm…'
          ) : (
            <div className="muted" style={{ padding: 4 }}>
              Không thấy {label} nào.{!noAdd && type && <> Bấm <b>F4</b> (hoặc nút <b>+</b>) để thêm mới.</>}
            </div>
          )
        }
        options={merged.map((p) => ({
          value: p.id,
          label: `${p.code} – ${p.name}`,
          title: optTitle(p),
          children: undefined,
          p,
        }))}
        optionRender={(o) => {
          const p = (o.data as { p: PartnerLite }).p;
          return (
            <div className="opt-row">
              <span className="opt-code">{p.code}</span>
              <span className="opt-name">{p.name}</span>
              <span className="opt-meta">{p.phone}</span>
            </div>
          );
        }}
        style={{ width: '100%' }}
      />
      {!noAdd && type && (
      <Tooltip title={`Thêm ${label} mới (F4)`}>
        <Button icon={<PlusOutlined />} onClick={() => setAdding(true)} disabled={disabled} tabIndex={-1} aria-label={`Thêm ${label} mới`} />
      </Tooltip>
      )}
      {type && (
      <PartnerFormModal
        open={adding}
        type={type}
        record={null}
        initial={search ? { name: search } : undefined}
        onClose={() => setAdding(false)}
        onSaved={(p: Partner) => onChange?.({ id: p.id, code: p.code, name: p.name, phone: p.phone, address: p.address, is_customer: p.is_customer, is_supplier: p.is_supplier })}
      />
      )}
    </Space.Compact>
    </div>
  );
});
