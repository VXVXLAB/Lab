import { Select } from 'antd';
import { useAllGroups, useWarehouses } from '../api/hooks';

/** Lọc theo kho: bỏ trống = tất cả kho. */
export function WarehouseSelect({ value, onChange, width = 170, allLabel = 'Tất cả kho' }: { value: number | undefined; onChange: (v: number | undefined) => void; width?: number; allLabel?: string }) {
  const w = useWarehouses();
  return (
    <Select<number>
      allowClear
      showSearch
      optionFilterProp="label"
      aria-label="Kho"
      placeholder={allLabel}
      value={value}
      onChange={(v) => onChange(v)}
      style={{ width }}
      options={(w.data?.items ?? []).map((x) => ({ value: x.id, label: `${x.code} – ${x.name}` }))}
    />
  );
}

/** Lọc theo nhóm hàng (REQ-020). */
export function GroupSelect({ value, onChange, width = 190 }: { value: number | undefined; onChange: (v: number | undefined) => void; width?: number }) {
  const g = useAllGroups();
  return (
    <Select<number>
      allowClear
      showSearch
      optionFilterProp="label"
      aria-label="Nhóm hàng"
      placeholder="Mọi nhóm hàng"
      value={value}
      onChange={(v) => onChange(v)}
      style={{ width }}
      options={(g.data?.items ?? []).map((x) => ({ value: x.id, label: `${x.code} – ${x.name}` }))}
    />
  );
}
