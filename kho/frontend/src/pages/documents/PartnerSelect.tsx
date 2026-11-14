import { forwardRef, useMemo, useState } from 'react';
import { Button, Select, Space, Tooltip, type RefSelectProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { partnersApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import type { Partner, PartnerType } from '../../api/types';
import { useDebounced } from '../../lib/useDebounced';
import { PartnerFormModal } from '../catalog/PartnersPage';

export interface PartnerLite {
  id: number;
  code: string;
  name: string;
  phone?: string;
  address?: string;
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

/** Ô chọn khách hàng / nhà cung cấp: gõ mã, tên, điện thoại (không dấu được); thêm mới ngay tại chỗ. */
export const PartnerSelect = forwardRef<RefSelectProps, Props>(function PartnerSelect(
  { type, value, current, onChange, id, disabled, status, noAdd, allowClear, placeholder, style },
  ref,
) {
  const [search, setSearch] = useState('');
  const dq = useDebounced(search.trim(), 150);
  const [adding, setAdding] = useState(false);
  const params = useMemo(() => ({ q: dq || undefined, type, active: true, page_size: 30 }), [dq, type]);
  const q = useQuery({
    queryKey: qk.catalogList('partner', params),
    queryFn: () => partnersApi.list(params),
    staleTime: 30_000,
  });
  const items: PartnerLite[] = q.data?.items ?? [];
  const merged = current && !items.some((p) => p.id === current.id) ? [current, ...items] : items;
  const label = type === 'customer' ? 'khách hàng' : type === 'supplier' ? 'nhà cung cấp' : 'đối tác';

  return (
    <Space.Compact style={style ?? { width: '100%' }}>
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
        onSearch={setSearch}
        onKeyDown={(e) => {
          if (e.key === 'F4' && !noAdd && type) {
            e.preventDefault();
            setAdding(true);
          }
        }}
        loading={q.isFetching}
        onChange={(v) => {
          const p = merged.find((x) => x.id === v) ?? null;
          onChange?.(p);
          setSearch('');
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
          title: p.name,
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
        onSaved={(p: Partner) => onChange?.({ id: p.id, code: p.code, name: p.name, phone: p.phone, address: p.address })}
      />
      )}
    </Space.Compact>
  );
});
