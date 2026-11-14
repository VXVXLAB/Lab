import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, Input } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import { qk } from '../../api/queryKeys';
import { reportApi, type TradeParams } from '../../api/reports';
import type { TradeRow } from '../../api/types';
import { DateRangeFilter, rangeOf, type DateRangeValue, type Preset } from '../../components/DateRangeFilter';
import { ProductSelect, type ProductPick } from '../../components/ProductSelect';
import { OpenHint, ReportActions, ReportTable } from '../../components/ReportTable';
import { GroupSelect, WarehouseSelect } from '../../components/WarehouseSelect';
import { formatDate, formatMoney, formatQty, toApiDate, todayVn } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { DOC_TYPES } from '../documents/docTypes';
import { PartnerSelect, type PartnerLite } from '../documents/PartnerSelect';
import { useDrawers } from './drawers';

/**
 * Chi tiết bán hàng / mua hàng theo dòng (REQ-066/067); với mặt hàng cố định = lịch sử bán/mua của mã đó (REQ-021):
 * "bán cho ai, giá bao nhiêu, lần nào".
 */
export function TradeReportView({
  kind,
  fixedProduct,
  inDrawer = false,
  initialProduct = null,
  initialPreset,
}: {
  kind: 'sales' | 'purchases';
  fixedProduct?: ProductPick;
  inDrawer?: boolean;
  initialProduct?: ProductPick | null;
  initialPreset?: Preset;
}) {
  const drawers = useDrawers();
  const isSales = kind === 'sales';
  const [range, setRange] = useState<DateRangeValue>({ preset: initialPreset ?? (fixedProduct ? 'all' : 'month'), range: [null, null] });
  const [partner, setPartner] = useState<PartnerLite | null>(null);
  const [product, setProduct] = useState<ProductPick | null>(fixedProduct ?? initialProduct);
  const [groupId, setGroupId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [withReturns, setWithReturns] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [from, to] = rangeOf(range);
  const params: TradeParams = useMemo(
    () => ({
      // "Tất cả" ⇒ gửi từ năm 2000 (bỏ trống thì máy chủ mặc định tháng này)
      from: toApiDate(from) ?? '2000-01-01',
      to: toApiDate(to) ?? toApiDate(todayVn()),
      partner_id: partner?.id,
      product_id: product?.id,
      group_id: groupId,
      warehouse_id: warehouseId,
      q: dq || undefined,
      include_returns: withReturns || undefined,
    }),
    [from?.valueOf(), to?.valueOf(), partner, product, groupId, warehouseId, dq, withReturns], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const query = useQuery({
    queryKey: qk.report(kind, params),
    queryFn: () => (isSales ? reportApi.sales(params) : reportApi.purchases(params)),
  });
  const d = query.data;
  const oneProduct = !!product;

  const columns: ColumnsType<TradeRow> = [
    { title: 'Ngày', dataIndex: 'date', width: 96, render: (s: string) => formatDate(s) },
    {
      title: 'Số phiếu',
      dataIndex: 'doc_no',
      width: 96,
      render: (s: string, r) => <span className={r.qty < 0 ? 'neg link-text' : 'link-text'}>{s}</span>,
    },
    { title: isSales ? 'Khách hàng' : 'Nhà cung cấp', dataIndex: 'partner_name', ellipsis: true, width: oneProduct ? undefined : 190 },
    ...(oneProduct
      ? []
      : [
          { title: 'Mã hàng', dataIndex: 'product_code', width: 110, ellipsis: true },
          {
            title: 'Tên hàng / diễn giải',
            key: 'desc',
            ellipsis: true,
            render: (_: unknown, r: TradeRow) => (r.is_service ? <span className="service-code">{r.description}</span> : r.description || r.product_name),
          },
        ]),
    { title: 'ĐVT', dataIndex: 'unit', width: 60 },
    { title: 'SL', dataIndex: 'qty', width: 80, align: 'right', render: (n: number) => <span className={n < 0 ? 'neg' : undefined}>{formatQty(n)}</span> },
    { title: 'Đơn giá', dataIndex: 'unit_price', width: 108, align: 'right', render: (n: number | null) => formatMoney(n) },
    { title: 'Thành tiền', dataIndex: 'amount', width: 120, align: 'right', render: (n: number, r) => (r.unit_price === null ? '' : <span className={n < 0 ? 'neg' : undefined}>{formatMoney(n)}</span>) },
    { title: 'Kho', dataIndex: 'warehouse_name', width: 104, ellipsis: true },
  ];
  const nCols = columns.length;
  const summary = d
    ? [
        <b key="l">Cộng</b>,
        <span key="n" className="muted">
          {d.document_count} phiếu
        </span>,
        ...Array(nCols - 7).fill(null),
        null,
        <b key="q">{formatQty(d.total_qty)}</b>,
        null,
        <b key="a">{formatMoney(d.total_amount)}</b>,
        null,
      ]
    : null;

  return (
    <>
      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
        <PartnerSelect
          type={isSales ? 'customer' : 'supplier'}
          value={partner?.id ?? null}
          current={partner}
          onChange={setPartner}
          noAdd
          allowClear
          placeholder={isSales ? 'Khách hàng…' : 'Nhà cung cấp…'}
          style={{ width: 210 }}
        />
        {!fixedProduct && <ProductSelect value={product} onChange={setProduct} placeholder="Mặt hàng…" width={210} />}
        {!fixedProduct && !inDrawer && <GroupSelect value={groupId} onChange={setGroupId} width={160} />}
        {!inDrawer && <WarehouseSelect value={warehouseId} onChange={setWarehouseId} width={150} />}
        {!fixedProduct && (
          <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm số phiếu, tên…" style={{ width: 170 }} value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        <Checkbox checked={withReturns} onChange={(e) => setWithReturns(e.target.checked)}>
          Gồm {isSales ? 'khách trả hàng' : 'trả hàng NCC'}
        </Checkbox>
        <span style={{ marginLeft: 'auto' }} />
        <ReportActions xlsxUrl={reportApi.xlsxUrl(kind, params)} canPrint={!inDrawer} />
      </div>
      <div className="report-area">
        <div className="print-only report-print-title">
          {isSales ? 'CHI TIẾT BÁN HÀNG' : 'CHI TIẾT MUA HÀNG'} {product ? `— ${product.code} ${product.name}` : ''} · {formatDate(params.from)} – {formatDate(params.to)}
        </div>
        <ReportTable<TradeRow>
          columns={columns}
          rows={d?.rows ?? []}
          rowKey={(r) => `${r.document_id}-${r.line_no}`}
          loading={query.isLoading}
          error={query.error}
          summary={summary}
          minWidth={oneProduct ? 760 : 1060}
          onOpen={(r) => drawers.push({ kind: 'document', id: r.document_id, title: `${DOC_TYPES[r.doc_type].name} ${r.doc_no}` })}
        />
      </div>
      <OpenHint />
    </>
  );
}
