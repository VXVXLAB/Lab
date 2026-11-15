// Đơn vị quy đổi của một mặt hàng (bản mở rộng C10).
import { useEffect, useState } from 'react';
import { App, Alert, Button, Input, Space, Tag, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api/client';
import { unitsApi } from '../../api/extended';
import { useCan } from '../../auth/AuthContext';
import { NumberInput } from '../../components/NumberInput';
import { formatQty } from '../../lib/format';

interface Row {
  unit: string;
  factor: number | null;
  in_use?: boolean;
}

export function ProductUnitsEditor({ productId, baseUnit }: { productId: number; baseUnit: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('catalog.write');
  const q = useQuery({ queryKey: ['product-units', productId], queryFn: () => unitsApi.get(productId) });
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) setRows(q.data.items.map((x) => ({ ...x })));
  }, [q.data]);
  const dirty = JSON.stringify(rows.map((r) => [r.unit.trim(), r.factor])) !== JSON.stringify((q.data?.items ?? []).map((r) => [r.unit, r.factor]));
  const base = q.data?.base_unit ?? baseUnit;

  const save = async () => {
    setErr(null);
    const items = rows.filter((r) => r.unit.trim() || r.factor !== null);
    if (items.some((r) => !r.unit.trim() || !r.factor || r.factor <= 0)) return setErr('Mỗi dòng cần tên đơn vị và hệ số lớn hơn 0');
    setSaving(true);
    try {
      const r = await unitsApi.set(
        productId,
        items.map((x) => ({ unit: x.unit.trim(), factor: x.factor! })),
      );
      qc.setQueryData(['product-units', productId], r);
      message.success('Đã lưu đơn vị quy đổi', 1.5);
    } catch (e) {
      // đơn vị đã dùng trên chứng từ không bỏ / đổi hệ số được (409 IN_USE)
      setErr(e instanceof ApiError && e.code === 'IN_USE' ? `${e.message} — đơn vị này đã có trên chứng từ nên không bỏ hay đổi hệ số được.` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="units-editor">
      <div className="muted" style={{ marginBottom: 6 }}>
        Đơn vị gốc: <b>{base}</b> (tồn kho, thẻ kho tính theo đơn vị này). Thêm đơn vị khác để mua / bán theo thùng, hộp…
      </div>
      {rows.map((r, i) => (
        <Space key={i} className="unit-row" align="center" wrap>
          <span>1</span>
          <Input
            value={r.unit}
            disabled={!canEdit || r.in_use}
            placeholder="Thùng"
            style={{ width: 110 }}
            maxLength={30}
            onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
            aria-label={`Tên đơn vị ${i + 1}`}
          />
          <span>=</span>
          <NumberInput
            kind="qty"
            value={r.factor}
            disabled={!canEdit || r.in_use}
            style={{ width: 110 }}
            onChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, factor: v } : x)))}
            aria-label={`Hệ số đơn vị ${i + 1}`}
          />
          <span>{base}</span>
          {r.in_use && (
            <Tooltip title="Đã có trên chứng từ — không bỏ hay đổi hệ số được">
              <Tag>đang dùng</Tag>
            </Tooltip>
          )}
          {canEdit && !r.in_use && (
            <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`Bỏ đơn vị ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
          )}
          {r.unit.trim() && r.factor ? (
            <span className="muted">
              (1 {r.unit.trim()} = {formatQty(r.factor)} {base})
            </span>
          ) : null}
        </Space>
      ))}
      {canEdit && (
        <Space style={{ marginTop: 6 }}>
          <Button size="small" icon={<PlusOutlined />} onClick={() => setRows((rs) => [...rs, { unit: '', factor: null }])}>
            Thêm đơn vị
          </Button>
          <Button size="small" type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={() => void save()}>
            Lưu đơn vị quy đổi
          </Button>
        </Space>
      )}
      {err && <Alert style={{ marginTop: 6 }} type="error" showIcon message={err} />}
    </div>
  );
}
