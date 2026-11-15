import { ProductUnitsEditor } from '../extended/ProductUnits';
import { useMemo, useState } from 'react';
import { useCan, useFeature } from '../../auth/AuthContext';
import { AutoComplete, Button, Empty, Form, Input, Segmented, Select, Skeleton, Switch, Table, Tag, Tooltip } from 'antd';
import { FileSearchOutlined, HistoryOutlined } from '@ant-design/icons';
import { useDrawers } from '../reports/drawers';
import type { ColumnsType } from 'antd/es/table';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { productGroupsApi, productsApi } from '../../api/catalog';
import { errorMessage } from '../../api/client';
import { qk } from '../../api/queryKeys';
import type { PriceInfo, Product, ProductBody, ProductGroup, ProductWithStock } from '../../api/types';
import { activeColumn, CatalogList, foldVietnamese } from '../../components/CatalogList';
import { filterByLabel } from '../../lib/text';
import { EntityFormModal } from '../../components/EntityFormModal';
import { NumberInput } from '../../components/NumberInput';
import { formatDate, formatMoney, formatQty } from '../../lib/format';
import { codeRules, nameRules, normalizeCode } from './rules';
import { useEditor } from './useEditor';

const UNITS = ['Cái', 'Bộ', 'Hộp', 'Thùng', 'Cuộn', 'Kg', 'Mét', 'Cây', 'Bao', 'Đôi', 'Chiếc', 'Lít', 'Tấm', 'Sợi'];
type Kind = 'all' | 'goods' | 'service';

const COST_SOURCE_TEXT: Record<PriceInfo['cost_source'], string> = {
  last_purchase: 'giá nhập mua gần nhất',
  default: 'giá mua khai báo (chưa có phiếu nhập)',
  none: 'chưa có giá mua',
};

/** Danh sách nhóm hàng cho ô chọn (dùng chung với các giai đoạn sau). */
export function useAllGroups() {
  return useQuery({
    queryKey: qk.catalogList('product_group', { all: true }),
    queryFn: () => productGroupsApi.list({ page_size: 1000 }),
    staleTime: 60_000,
  });
}

function StockPanel({ product }: { product: Product }) {
  const q = useQuery({
    queryKey: qk.priceInfo(product.id),
    queryFn: () => productsApi.priceInfo(product.id),
  });
  if (product.is_service) {
    return (
      <div className="aside-card">
        <h4>Tồn kho</h4>
        <div className="muted">Mã dịch vụ không theo dõi tồn kho.</div>
      </div>
    );
  }
  if (q.isLoading) return <Skeleton active paragraph={{ rows: 5 }} />;
  if (q.isError) return <div className="error-text">{errorMessage(q.error)}</div>;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="aside-card">
      <h4>
        Tồn kho đến hết {formatDate(d.date)}
      </h4>
      <div className="stock-total">
        <span>Tổng các kho</span>
        <b className={d.total_stock <= 0 ? 'neg' : undefined}>
          {formatQty(d.total_stock)} {d.unit}
        </b>
      </div>
      <Table
        size="small"
        rowKey="warehouse_id"
        pagination={false}
        dataSource={d.stock_by_warehouse}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có kho" /> }}
        columns={[
          { title: 'Kho', dataIndex: 'name', render: (n: string, r) => `${r.code} – ${n}` },
          {
            title: 'Tồn',
            dataIndex: 'qty',
            align: 'right',
            width: 90,
            render: (n: number) => <span className={n < 0 ? 'neg' : n === 0 ? 'muted' : undefined}>{formatQty(n)}</span>,
          },
        ]}
      />
      {d.cost_price !== null && (
        <div className="cost-line">
          Giá vốn để cảnh báo bán lỗ: <b>{d.cost_source === 'none' ? '–' : formatMoney(d.cost_price)}</b>
          <div className="muted">({COST_SOURCE_TEXT[d.cost_source]})</div>
        </div>
      )}
    </div>
  );
}

export function ProductsPage() {
  const drawers = useDrawers();
  const ed = useEditor<Product>();
  const [form] = Form.useForm<ProductBody>();
  const qc = useQueryClient();
  const rec = ed.record;
  const costView = useCan('cost.view');
  const minOn = useFeature('min_stock');
  const vatOn = useFeature('vat');
  const unitsOn = useFeature('unit_conversion');
  const [groupId, setGroupId] = useState<number | undefined>(undefined);
  const [kind, setKind] = useState<Kind>('all');
  const groups = useAllGroups();
  const groupItems: ProductGroup[] = groups.data?.items ?? [];

  // Tồn tổng của mọi mã trong một lần gọi (báo cáo tồn kho), ghép vào cột "Tồn".
  // Tồn tổng (đến hết hôm nay) đi kèm danh sách: with_stock=true

  const extraParams = useMemo(
    () => ({ group_id: groupId, is_service: kind === 'all' ? undefined : kind === 'service' }),
    [groupId, kind],
  );

  const columns: ColumnsType<Product> = [
    { title: 'Mã hàng', dataIndex: 'code', width: 125, className: 'col-code', ellipsis: true },
    {
      title: 'Tên hàng',
      dataIndex: 'name',
      ellipsis: { showTitle: true },
      render: (n: string, r) => (
        <>
          {n} {r.is_service && <Tag color="cyan">Dịch vụ</Tag>}
        </>
      ),
    },
    { title: 'ĐVT', dataIndex: 'unit', width: 66 },
    { title: 'Nhóm', dataIndex: 'group_name', width: 150, ellipsis: true, render: (g: string | null) => g ?? <span className="muted">–</span> },
    { title: 'Giá bán', dataIndex: 'sale_price', width: 108, align: 'right', render: (n: number) => formatMoney(n) },
    // không có quyền "Xem giá mua" (bản mở rộng) ⇒ bỏ hẳn cột
    ...(costView ? [{ title: 'Giá mua', dataIndex: 'purchase_price', width: 108, align: 'right' as const, render: (n: number) => formatMoney(n) }] : []),
    {
      title: 'Tồn',
      key: 'stock',
      width: 80,
      align: 'right',
      render: (_, r) => {
        if (r.is_service) return <span className="muted">–</span>;
        const n = (r as ProductWithStock).total_stock;
        if (n === undefined) return <span className="muted">…</span>;
        const low = minOn && r.min_stock !== null && r.min_stock !== undefined && n <= r.min_stock;
        return <span className={n <= 0 || low ? 'neg' : undefined}>{formatQty(n)}</span>;
      },
    },
    ...(minOn
      ? [
          {
            title: 'Tồn tối thiểu',
            dataIndex: 'min_stock',
            width: 96,
            align: 'right' as const,
            render: (n: number | null | undefined) => (n === null || n === undefined ? <span className="muted">–</span> : formatQty(n)),
          },
        ]
      : []),
    activeColumn<Product>(),
  ];

  const groupOptions = groupItems.map((g) => ({
    value: g.id,
    label: `${g.code} – ${g.name}`,
    disabled: !g.active && g.id !== rec?.group_id,
  }));

  return (
    <>
      <CatalogList<Product>
        entity="product"
        title="Hàng hóa, dịch vụ"
        noun="mặt hàng"
        fetchList={productsApi.listWithStock}
        extraParams={extraParams}
        searchPlaceholder="Tìm mã, tên hàng (gõ không dấu được)"
        describe={(r) => `${r.code} – ${r.name}`}
        columns={columns}
        minWidth={1120}
        extraActionsWidth={64}
        extraActions={(r) =>
          r.is_service ? null : (
            <>
              <Tooltip title="Thẻ kho">
                <Button type="text" size="small" icon={<FileSearchOutlined />} aria-label="Thẻ kho" onClick={() => drawers.push({ kind: 'ledger', product: { id: r.id, code: r.code, name: r.name, unit: r.unit } })} />
              </Tooltip>
              <Tooltip title="Lịch sử bán (bán cho ai, giá bao nhiêu)">
                <Button type="text" size="small" icon={<HistoryOutlined />} aria-label="Lịch sử bán" onClick={() => drawers.push({ kind: 'trade', report: 'sales', product: { id: r.id, code: r.code, name: r.name, unit: r.unit } })} />
              </Tooltip>
            </>
          )
        }
        filters={
          <>
            <Select<number>
              allowClear
              placeholder="Tất cả nhóm hàng"
              style={{ width: 210 }}
              value={groupId}
              onChange={(v) => setGroupId(v)}
              options={groupOptions}
              showSearch
              filterOption={filterByLabel}
            />
            <Segmented<Kind>
              value={kind}
              onChange={setKind}
              options={[
                { label: 'Tất cả', value: 'all' },
                { label: 'Hàng hóa', value: 'goods' },
                { label: 'Dịch vụ', value: 'service' },
              ]}
            />
          </>
        }
        onCreate={ed.openCreate}
        onEdit={ed.openEdit}
        onDelete={(r) => productsApi.remove(r.id)}
        onDeactivate={(r) => productsApi.update(r.id, toBody(r, { active: false }))}
      />
      <EntityFormModal<ProductBody>
        open={ed.open}
        width={600}
        title={rec ? `Sửa mặt hàng ${rec.code}` : 'Thêm mặt hàng'}
        form={form}
        initialValues={
          rec
            ? toBody(rec)
            : { code: '', name: '', unit: '', group_id: groupId ?? null, sale_price: 0, purchase_price: 0, is_service: false, active: true }
        }
        aside={rec ? <StockPanel product={rec} /> : undefined}
        onClose={ed.close}
        onSubmit={(v) => {
          const body: ProductBody = {
            code: normalizeCode(v.code),
            name: v.name.trim(),
            unit: (v.unit ?? '').trim(),
            group_id: v.group_id ?? null,
            sale_price: v.sale_price ?? 0,
            // không thấy giá mua ⇒ gửi null: máy chủ giữ giá cũ (mặt hàng mới: 0)
            purchase_price: costView ? (v.purchase_price ?? 0) : null,
            is_service: !!v.is_service,
            active: v.active,
            // bản mở rộng (tồn tối thiểu bật): gửi kèm; tắt ⇒ không gửi (máy chủ giữ nguyên)
            ...(minOn ? { min_stock: v.min_stock ?? null } : {}),
            // C11: thuế suất mặc định (trống = theo mặc định chung)
            ...(vatOn ? { vat_rate: v.vat_rate ?? null } : {}),
          };
          return rec ? productsApi.update(rec.id, body) : productsApi.create(body);
        }}
        onSaved={() => {
          void qc.invalidateQueries({ queryKey: qk.catalog('product') });
          void qc.invalidateQueries({ queryKey: qk.reports });
        }}
      >
        <Form.Item label="Mã hàng" name="code" rules={codeRules}>
          <Input maxLength={50} style={{ width: 220 }} disabled={rec?.code === 'DV'} />
        </Form.Item>
        <Form.Item label="Tên hàng" name="name" rules={nameRules}>
          <Input maxLength={300} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.is_service !== b.is_service}>
          {({ getFieldValue }) => (
            <Form.Item
              label="Đơn vị tính"
              name="unit"
              rules={getFieldValue('is_service') ? [] : [{ required: true, whitespace: true, message: 'Vui lòng nhập đơn vị tính' }]}
            >
              <AutoComplete
                style={{ width: 160 }}
                options={UNITS.map((u) => ({ value: u }))}
                filterOption={(input, opt) => foldVietnamese(String(opt?.value ?? '')).startsWith(foldVietnamese(input))}
              />
            </Form.Item>
          )}
        </Form.Item>
        <Form.Item label="Nhóm hàng" name="group_id">
          <Select<number>
            allowClear
            placeholder="Chọn nhóm"
            options={groupOptions}
            showSearch
            filterOption={filterByLabel}
          />
        </Form.Item>
        <Form.Item label="Giá bán" name="sale_price" extra="Tự điền vào phiếu bán; vẫn sửa được khi bán.">
          <NumberInput style={{ width: 180 }} suffix="đ" />
        </Form.Item>
        {costView && (
          <Form.Item label="Giá mua" name="purchase_price" extra="Dùng làm giá vốn khi mã chưa có phiếu nhập nào.">
            <NumberInput style={{ width: 180 }} suffix="đ" />
          </Form.Item>
        )}
        {vatOn && (
          <Form.Item label="Thuế suất mặc định" name="vat_rate" extra="Tự điền vào cột Thuế của phiếu mua / bán. Để trống = theo mặc định chung (Hệ thống › Thông tin công ty).">
            <Select<string>
              allowClear
              placeholder="Theo mặc định chung"
              style={{ width: 200 }}
              options={[
                { value: 'KCT', label: 'Không chịu thuế (KCT)' },
                { value: '0', label: '0%' },
                { value: '5', label: '5%' },
                { value: '8', label: '8%' },
                { value: '10', label: '10%' },
              ]}
            />
          </Form.Item>
        )}
        {unitsOn && rec && !rec.is_service && (
          <Form.Item label="Đơn vị quy đổi">
            <ProductUnitsEditor productId={rec.id} baseUnit={rec.unit} />
          </Form.Item>
        )}
        {minOn && (
          <Form.Item
            label="Tồn tối thiểu"
            name="min_stock"
            extra="Tính trên tổng các kho. Tồn ≤ mức này là hàng cần đặt thêm. Để trống = không theo dõi."
          >
            <NumberInput style={{ width: 180 }} />
          </Form.Item>
        )}
        <Form.Item
          label="Là dịch vụ"
          name="is_service"
          valuePropName="checked"
          extra="Dịch vụ không theo dõi tồn kho (cước xe, phí sửa, ghi chú…). Đã có chứng từ thì không đổi được."
        >
          <Switch checkedChildren="Có" unCheckedChildren="Không" disabled={rec?.code === 'DV'} />
        </Form.Item>
        <Form.Item label="Đang sử dụng" name="active" valuePropName="checked">
          <Switch checkedChildren="Có" unCheckedChildren="Không" />
        </Form.Item>
      </EntityFormModal>
    </>
  );
}

function toBody(p: Product, over: Partial<ProductBody> = {}): ProductBody {
  return {
    code: p.code,
    name: p.name,
    unit: p.unit,
    group_id: p.group_id,
    sale_price: p.sale_price,
    purchase_price: p.purchase_price,
    is_service: p.is_service,
    active: p.active,
    ...(p.min_stock !== undefined ? { min_stock: p.min_stock } : {}),
    ...(p.vat_rate !== undefined ? { vat_rate: p.vat_rate } : {}),
    ...over,
  };
}
