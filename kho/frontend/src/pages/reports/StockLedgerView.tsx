import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { qk } from '../../api/queryKeys';
import { useWarehouses } from '../../api/hooks';
import { reportApi, type LedgerParams } from '../../api/reports';
import type { StockLedgerRow } from '../../api/types';
import { DateRangeFilter, describeRange, rangeOf, type DateRangeValue } from '../../components/DateRangeFilter';
import { ProductSelect, type ProductPick } from '../../components/ProductSelect';
import { OpenHint, PrintTitle, ReportActions, ReportTable } from '../../components/ReportTable';
import { PageHeader } from '../../components/PageHeader';
import { WarehouseSelect } from '../../components/WarehouseSelect';
import { formatDate, formatQty, fromApiDate, toApiDate } from '../../lib/format';
import { DOC_TYPES } from '../documents/docTypes';
import { useDrawers } from './drawers';

type Row = (StockLedgerRow & { _kind: 'row' }) | { _kind: 'opening'; product_code: string; unit: string; balance: number };

const dash = (n: number) => (n ? formatQty(n) : '-');

/**
 * Thẻ kho / chi tiết nhập xuất tồn một mã (REQ-012…019), bố cục như mẫu của khách:
 * Mã hàng | Ngày hạch toán | Số chứng từ | Diễn giải | ĐVT | Nhập | Xuất | Tồn; dòng đầu "Số dư đầu kỳ", dòng cuối Cộng.
 */
export function StockLedgerView({
  product: fixedProduct,
  onProductChange,
  initialWarehouseId,
  initialFrom,
  initialTo,
  inDrawer = false,
  pageTitle,
  pageSub,
}: {
  pageTitle?: string;
  pageSub?: string;
  product: ProductPick | null;
  /** Có ⇒ hiện ô chọn mặt hàng (màn Thẻ kho) */
  onProductChange?: (p: ProductPick | null) => void;
  initialWarehouseId?: number;
  initialFrom?: string;
  initialTo?: string;
  inDrawer?: boolean;
}) {
  const drawers = useDrawers();
  const whs = useWarehouses();
  const [warehouseId, setWarehouseId] = useState<number | undefined>(initialWarehouseId);
  const [range, setRange] = useState<DateRangeValue>(() =>
    initialFrom || initialTo
      ? { preset: 'custom', range: [fromApiDate(initialFrom), fromApiDate(initialTo)] }
      : { preset: 'year', range: [null, null] },
  );
  const [from, to] = rangeOf(range);
  const product = fixedProduct;
  const params: LedgerParams | null = product
    ? { product_id: product.id, warehouse_id: warehouseId, from: toApiDate(from), to: toApiDate(to) }
    : null;

  const q = useQuery({
    queryKey: qk.report('stock-ledger', params ?? {}),
    queryFn: () => reportApi.stockLedger(params!),
    enabled: !!params,
  });
  const d = q.data;

  const rows: Row[] = useMemo(() => {
    if (!d) return [];
    return [
      { _kind: 'opening', product_code: d.product.code, unit: d.product.unit, balance: d.opening },
      ...d.rows.map((r) => ({ ...r, _kind: 'row' as const })),
    ];
  }, [d]);

  const allWh = warehouseId === undefined;
  const columns: ColumnsType<Row> = [
    { title: 'Mã hàng', key: 'code', width: 130, render: (_, r) => r.product_code },
    { title: 'Ngày hạch toán', key: 'date', width: 122, render: (_, r) => (r._kind === 'row' ? formatDate(r.date) : '') },
    {
      title: 'Số chứng từ',
      key: 'no',
      width: 100,
      render: (_, r) => (r._kind === 'row' ? <span className="link-text">{r.doc_no}</span> : ''),
    },
    {
      title: 'Diễn giải',
      key: 'desc',
      render: (_, r) =>
        r._kind === 'opening' ? (
          <b>Số dư đầu kỳ</b>
        ) : (
          <span title={DOC_TYPES[r.doc_type].name}>{r.description}</span>
        ),
    },
    ...(allWh ? [{ title: 'Kho', key: 'wh', width: 64, render: (_: unknown, r: Row) => (r._kind === 'row' ? r.warehouse_code : '') }] : []),
    { title: 'ĐVT', key: 'unit', width: 64, render: (_, r) => r.unit },
    { title: 'Nhập', key: 'in', width: 90, align: 'right', render: (_, r) => (r._kind === 'row' ? dash(r.qty_in) : '-') },
    { title: 'Xuất', key: 'out', width: 90, align: 'right', render: (_, r) => (r._kind === 'row' ? dash(r.qty_out) : '-') },
    {
      title: 'Tồn',
      key: 'bal',
      width: 96,
      align: 'right',
      render: (_, r) => <b className={r.balance < 0 ? 'neg' : undefined}>{formatQty(r.balance)}</b>,
    },
  ];
  const summary = d
    ? [null, null, null, <b key="c">Cộng</b>, ...(allWh ? [null] : []), null, <b key="i">{formatQty(d.total_in)}</b>, <b key="o">{formatQty(d.total_out)}</b>, <b key="b">{formatQty(d.closing)}</b>]
    : null;

  return (
    <>
      {pageTitle && <PageHeader title={pageTitle} sub={pageSub} actions={params ? <ReportActions xlsxUrl={reportApi.xlsxUrl('stock-ledger', params)} /> : undefined} />}
      <div className="toolbar">
        {onProductChange && <ProductSelect value={product} onChange={onProductChange} goodsOnly allowClear={false} placeholder="Chọn mặt hàng cần xem thẻ kho…" width={300} />}
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} width={160} />
        <DateRangeFilter value={range} onChange={setRange} />
        {!pageTitle && (
          <>
            <span style={{ marginLeft: 'auto' }} />
            {params && <ReportActions xlsxUrl={reportApi.xlsxUrl('stock-ledger', params)} canPrint={!inDrawer} />}
          </>
        )}
      </div>
      {allWh && product && <div className="muted small-note">Xem tất cả kho: không hiện dòng chuyển kho nội bộ (tự triệt tiêu). Chọn một kho để thấy cả chuyển kho.</div>}
      {!product ? (
        <div className="report-empty">
          <Empty description="Chọn mặt hàng để xem thẻ kho (nhập – xuất – tồn từng chứng từ, có tên khách hàng / nhà cung cấp)" />
        </div>
      ) : (
        <div className="report-area">
          <PrintTitle
            title={`THẺ KHO — ${product.code} ${product.name}`}
            filters={[allWh ? 'Tất cả kho (không gồm chuyển kho nội bộ)' : `Kho: ${whs.data?.items.find((w) => w.id === warehouseId)?.name ?? ''}`, describeRange(range)]}
          />
          <ReportTable<Row>
            columns={columns}
            rows={rows}
            rowKey={(r, i) => (r._kind === 'row' ? `${r.document_id}-${i}` : 'opening')}
            loading={q.isLoading}
            error={q.error}
            summary={summary}
            minWidth={780}
            rowClassName={(r) => (r._kind === 'opening' ? 'row-opening' : '')}
            onOpen={(r) => r._kind === 'row' && drawers.push({ kind: 'document', id: r.document_id, title: `${DOC_TYPES[r.doc_type].name} ${r.doc_no}` })}
            emptyText="Không có phát sinh trong khoảng này"
          />
        </div>
      )}
      {product && <OpenHint />}
    </>
  );
}
