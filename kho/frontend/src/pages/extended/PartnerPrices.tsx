// Bảng giá riêng của một khách hàng (bản mở rộng, C6 price_list).
import { useState } from 'react';
import { App, Alert, Button, Input, Modal, Popconfirm, Space, Table, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined, TagsOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../api/client';
import { priceListApi } from '../../api/extended';
import type { PartnerPrice } from '../../api/types';
import { useCan, useFeature } from '../../auth/AuthContext';
import { NumberInput } from '../../components/NumberInput';
import { ProductSelect, type ProductPick } from '../../components/ProductSelect';
import { formatDateTime, formatMoney } from '../../lib/format';

export const qkPartnerPrices = (id: number) => ['partner-prices', id] as const;

/** Ô giá / ghi chú sửa tại chỗ: lưu khi rời ô hoặc Enter (nếu có đổi). */
function PriceCell({ row, partnerId, editable }: { row: PartnerPrice; partnerId: number; editable: boolean }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [price, setPrice] = useState<number | null>(row.price);
  const save = async () => {
    if (price === null || price === row.price) return setPrice(row.price);
    try {
      await priceListApi.upsert(partnerId, [{ product_id: row.product_id, price, note: row.note }]);
      void qc.invalidateQueries({ queryKey: qkPartnerPrices(partnerId) });
      void qc.invalidateQueries({ queryKey: ['sale-price'] });
      message.success(`Đã lưu giá ${row.product_code}`, 1.2);
    } catch (e) {
      message.error(errorMessage(e));
      setPrice(row.price);
    }
  };
  if (!editable) return <>{formatMoney(row.price)}</>;
  return (
    <NumberInput
      value={price}
      onChange={setPrice}
      onBlur={() => void save()}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      aria-label={`Giá riêng ${row.product_code}`}
      style={{ width: 130 }}
    />
  );
}

function NoteCell({ row, partnerId, editable }: { row: PartnerPrice; partnerId: number; editable: boolean }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [note, setNote] = useState(row.note ?? '');
  if (!editable) return <>{row.note}</>;
  const save = async () => {
    if (note.trim() === (row.note ?? '')) return;
    try {
      await priceListApi.upsert(partnerId, [{ product_id: row.product_id, price: row.price, note: note.trim() }]);
      void qc.invalidateQueries({ queryKey: qkPartnerPrices(partnerId) });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  return (
    <Input
      value={note}
      maxLength={200}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => void save()}
      onPressEnter={(e) => e.currentTarget.blur()}
      placeholder="ví dụ: theo hợp đồng"
      aria-label={`Ghi chú giá ${row.product_code}`}
    />
  );
}

/** Bảng giá riêng (dùng trong hộp thoại). */
export function PartnerPriceList({ partnerId }: { partnerId: number }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const canEdit = useCan('sale.write');
  const q = useQuery({ queryKey: qkPartnerPrices(partnerId), queryFn: () => priceListApi.list(partnerId) });
  const [pick, setPick] = useState<ProductPick | null>(null);
  const [newPrice, setNewPrice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = q.data?.items ?? [];

  const add = async () => {
    if (!pick || newPrice === null) return;
    setBusy(true);
    try {
      await priceListApi.upsert(partnerId, [{ product_id: pick.id, price: newPrice }]);
      setPick(null);
      setNewPrice(null);
      void qc.invalidateQueries({ queryKey: qkPartnerPrices(partnerId) });
      void qc.invalidateQueries({ queryKey: ['sale-price'] });
      message.success('Đã thêm giá riêng', 1.2);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (r: PartnerPrice) => {
    try {
      await priceListApi.remove(partnerId, r.product_id);
      void qc.invalidateQueries({ queryKey: qkPartnerPrices(partnerId) });
      void qc.invalidateQueries({ queryKey: ['sale-price'] });
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  return (
    <div className="price-list">
      <div className="muted" style={{ marginBottom: 8 }}>
        Giá riêng được tự điền khi lập phiếu bán cho khách này (trước giá bán lần trước và giá bán mặc định). Vẫn sửa được trên phiếu. Nhập
        nhiều mã một lúc: Danh mục › Nhập từ Excel › Bảng giá riêng.
      </div>
      {canEdit && (
        <Space className="price-add" wrap>
          <ProductSelect value={pick} onChange={setPick} placeholder="Tìm mặt hàng để thêm…" width={320} />
          <NumberInput value={newPrice} onChange={setNewPrice} placeholder="Giá riêng" suffix="đ" style={{ width: 160 }} aria-label="Giá riêng mới" />
          <Button icon={<PlusOutlined />} onClick={() => void add()} disabled={!pick || newPrice === null} loading={busy}>
            Thêm
          </Button>
        </Space>
      )}
      {q.isError && <Alert type="error" showIcon message={errorMessage(q.error)} />}
      <Table<PartnerPrice>
        size="small"
        rowKey="product_id"
        loading={q.isLoading}
        dataSource={rows}
        pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
        scroll={{ y: 360 }}
        locale={{ emptyText: 'Chưa có giá riêng nào cho khách này.' }}
        columns={[
          { title: 'Mã hàng', dataIndex: 'product_code', width: 120, className: 'col-code' },
          { title: 'Tên hàng', dataIndex: 'product_name', ellipsis: true },
          { title: 'ĐVT', dataIndex: 'unit', width: 60 },
          { title: 'Giá mặc định', dataIndex: 'default_price', width: 110, align: 'right', render: (n: number) => <span className="muted">{formatMoney(n)}</span> },
          {
            title: 'Giá riêng',
            key: 'price',
            width: 150,
            align: 'right',
            render: (_, r) => <PriceCell key={`${r.product_id}-${r.updated_at}`} row={r} partnerId={partnerId} editable={canEdit} />,
          },
          { title: 'Ghi chú', key: 'note', width: 180, render: (_, r) => <NoteCell key={`${r.product_id}-${r.updated_at}`} row={r} partnerId={partnerId} editable={canEdit} /> },
          {
            title: 'Sửa lần cuối',
            key: 'upd',
            width: 150,
            render: (_, r) => (
              <Tooltip title={formatDateTime(r.updated_at)}>
                <span className="cell-sub">{r.updated_by_name}</span>
              </Tooltip>
            ),
          },
          ...(canEdit
            ? [
                {
                  title: '',
                  key: 'del',
                  width: 44,
                  render: (_: unknown, r: PartnerPrice) => (
                    <Popconfirm title={`Bỏ giá riêng của ${r.product_code}?`} okText="Bỏ" cancelText="Thôi" onConfirm={() => void remove(r)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label={`Bỏ giá riêng ${r.product_code}`} />
                    </Popconfirm>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}

/** Nút mở "Bảng giá riêng" của khách (chỉ khi tính năng Giá theo khách bật). */
export function PartnerPricesButton({ partner, asLink }: { partner: { id: number; code: string; name: string }; asLink?: boolean }) {
  const on = useFeature('price_list');
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <Tooltip title="Bảng giá riêng của khách">
        <Button
          type={asLink ? 'link' : 'text'}
          size="small"
          icon={<TagsOutlined />}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={`Bảng giá riêng ${partner.code}`}
        >
          {asLink ? 'Bảng giá riêng…' : null}
        </Button>
      </Tooltip>
      {open && (
        <Modal open width={1000} title={`Bảng giá riêng — ${partner.code} ${partner.name}`} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
          <PartnerPriceList partnerId={partner.id} />
        </Modal>
      )}
    </>
  );
}
