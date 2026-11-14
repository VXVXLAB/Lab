import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, Input, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { productsApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import { reportApi, type NxtParams, type StockSummaryParams } from '../../api/reports';
import type { StockNxtItem, StockSummaryItem } from '../../api/types';
import { DateInput } from '../../components/DateInput';
import { DateRangeFilter, rangeOf, type DateRangeValue } from '../../components/DateRangeFilter';
import { PageHeader } from '../../components/PageHeader';
import type { ProductPick } from '../../components/ProductSelect';
import { OpenHint, PrintTitle, ReportActions, ReportTable } from '../../components/ReportTable';
import { useAllGroups, useWarehouses } from '../../api/hooks';
import { GroupSelect, WarehouseSelect } from '../../components/WarehouseSelect';
import { formatDate, formatQty, toApiDate, todayVn } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { useDrawers } from './drawers';
import { StockLedgerView } from './StockLedgerView';

const pick = (r: { product_id: number; code: string; name: string; unit: string }): ProductPick => ({ id: r.product_id, code: r.code, name: r.name, unit: r.unit });

/** Tồn kho: mỗi mã một dòng, mỗi kho một cột + tổng (REQ-009/010/020/022/063/075). Bấm số ⇒ thẻ kho. */
export function StockSummaryPage() {
  const drawers = useDrawers();
  const groups = useAllGroups();
  const [asOf, setAsOf] = useState<Dayjs | null>(todayVn());
  const [groupId, setGroupId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [onlyData, setOnlyData] = useState(true);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const params: StockSummaryParams = useMemo(
    () => ({ as_of: toApiDate(asOf), group_id: groupId, warehouse_id: warehouseId, q: dq || undefined, only_with_data: onlyData }),
    [asOf, groupId, warehouseId, dq, onlyData],
  );
  const query = useQuery({ queryKey: qk.report('stock-summary', params), queryFn: () => reportApi.stockSummary(params) });
  const d = query.data;
  const whs = d?.warehouses ?? [];
  const to = toApiDate(asOf);

  const openLedger = (r: StockSummaryItem, wh?: number) => drawers.push({ kind: 'ledger', product: pick(r), warehouseId: wh, to });
  const qtyCell = (r: StockSummaryItem, n: number, wh?: number) => (
    <Tooltip title={`Xem thẻ kho ${wh ? 'kho này' : 'tất cả kho'}`} mouseEnterDelay={0.6}>
      <span
        className={`qty-link${n < 0 ? ' neg' : n === 0 ? ' muted' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          openLedger(r, wh);
        }}
      >
        {formatQty(n)}
      </span>
    </Tooltip>
  );

  const columns: ColumnsType<StockSummaryItem> = [
    { title: 'Mã hàng', dataIndex: 'code', width: 120, ellipsis: true, className: 'col-code' },
    { title: 'Tên hàng', dataIndex: 'name', ellipsis: true },
    { title: 'ĐVT', dataIndex: 'unit', width: 58 },
    { title: 'Nhóm hàng', dataIndex: 'group_name', width: 140, ellipsis: true },
    ...whs.map((w) => ({
      title: <Tooltip title={w.name}>{w.code}</Tooltip>,
      key: `w${w.id}`,
      width: 84,
      align: 'right' as const,
      render: (_: unknown, r: StockSummaryItem) => qtyCell(r, r.by_warehouse[String(w.id)] ?? 0, w.id),
    })),
    { title: 'Tổng tồn', key: 'total', width: 96, align: 'right', render: (_, r) => <b>{qtyCell(r, r.total)}</b> },
  ];
  const summary = d
    ? [
        <b key="c">Cộng</b>,
        <span key="n" className="muted">
          {d.items.length} mã
        </span>,
        null,
        null,
        ...whs.map((w) => <b key={w.id}>{formatQty(d.totals_by_warehouse[String(w.id)] ?? 0)}</b>),
        <b key="t">{formatQty(d.total_qty)}</b>,
      ]
    : null;

  return (
    <div className="list-page">
      <PageHeader
        title="Tồn kho"
        sub={`Tồn đến hết ngày ${formatDate(asOf)} — tổng các kho và từng kho. Bấm vào số để xem thẻ kho.`}
        actions={<ReportActions xlsxUrl={reportApi.xlsxUrl('stock-summary', params)} />}
      />
      <div className="toolbar">
        <span className="range">
          <span className="muted">Đến ngày</span>
          <DateInput value={asOf} onChange={(v) => setAsOf(v ?? todayVn())} style={{ width: 140 }} />
        </span>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm mã, tên hàng…" style={{ width: 220 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <GroupSelect value={groupId} onChange={setGroupId} />
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} allLabel="Cả 4 kho" />
        <Tooltip title="Bỏ chọn để liệt kê cả mã chưa từng nhập/xuất (tồn 0)">
          <Checkbox checked={onlyData} onChange={(e) => setOnlyData(e.target.checked)}>
            Chỉ mã có phát sinh
          </Checkbox>
        </Tooltip>
      </div>
      <div className="report-area">
        <PrintTitle
          title={`BÁO CÁO TỒN KHO đến hết ngày ${formatDate(asOf)}`}
          filters={[
            warehouseId ? `Kho: ${d?.warehouses[0]?.name ?? ''}` : 'Cả 4 kho',
            groupId && `Nhóm: ${groups.data?.items.find((g) => g.id === groupId)?.name ?? ''}`,
            dq && `Tìm: "${dq}"`,
            onlyData ? 'Chỉ mã có phát sinh' : 'Gồm cả mã chưa phát sinh',
          ]}
        />
        <ReportTable<StockSummaryItem>
          columns={columns}
          rows={d?.items ?? []}
          rowKey={(r) => r.product_id}
          loading={query.isLoading}
          error={query.error}
          summary={summary}
          minWidth={560 + whs.length * 84 + 96}
          onOpen={(r) => openLedger(r)}
        />
      </div>
      <OpenHint what="xem thẻ kho mã đó" />
    </div>
  );
}

/** Thẻ kho / chi tiết NXT một mã (REQ-012…019). Đường dẫn nhận ?product_id=&warehouse_id=&from=&to=. */
export function StockLedgerPage() {
  const [sp, setSp] = useSearchParams();
  const pid = Number(sp.get('product_id')) || null;
  const [product, setProduct] = useState<ProductPick | null>(null);
  const pq = useQuery({ queryKey: qk.catalogItem('product', pid ?? 0), queryFn: () => productsApi.get(pid ?? 0), enabled: !!pid && product?.id !== pid });
  useEffect(() => {
    if (pq.data && pq.data.id === pid) setProduct({ id: pq.data.id, code: pq.data.code, name: pq.data.name, unit: pq.data.unit });
  }, [pq.data, pid]);
  return (
    <div className="list-page">
      <StockLedgerView
        pageTitle="Thẻ kho — chi tiết nhập xuất tồn"
        pageSub="Mỗi chứng từ một dòng, ghi rõ mua của ai / bán cho ai. Bấm dòng để xem phiếu."
        product={product}
        onProductChange={(p) => {
          setProduct(p);
          setSp(p ? { product_id: String(p.id) } : {}, { replace: true });
        }}
        initialWarehouseId={Number(sp.get('warehouse_id')) || undefined}
        initialFrom={sp.get('from') ?? undefined}
        initialTo={sp.get('to') ?? undefined}
      />
    </div>
  );
}

/** Tổng hợp nhập xuất tồn theo kỳ (REQ-064). Bấm mã ⇒ thẻ kho đúng kỳ. */
export function StockNxtPage() {
  const drawers = useDrawers();
  const groups = useAllGroups();
  const whs = useWarehouses();
  const [range, setRange] = useState<DateRangeValue>({ preset: 'month', range: [null, null] });
  const [groupId, setGroupId] = useState<number | undefined>();
  const [warehouseId, setWarehouseId] = useState<number | undefined>();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [from, to] = rangeOf(range);
  const params: NxtParams = useMemo(
    () => ({ from: toApiDate(from) ?? '2000-01-01', to: toApiDate(to) ?? toApiDate(todayVn()), group_id: groupId, warehouse_id: warehouseId, q: dq || undefined }),
    [from?.valueOf(), to?.valueOf(), groupId, warehouseId, dq], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const query = useQuery({ queryKey: qk.report('stock-nxt', params), queryFn: () => reportApi.stockNxt(params) });
  const d = query.data;
  const num = (n: number) => (n ? formatQty(n) : <span className="muted">-</span>);
  const columns: ColumnsType<StockNxtItem> = [
    { title: 'Mã hàng', dataIndex: 'code', width: 120, ellipsis: true, className: 'col-code' },
    { title: 'Tên hàng', dataIndex: 'name', ellipsis: true },
    { title: 'ĐVT', dataIndex: 'unit', width: 58 },
    { title: 'Nhóm hàng', dataIndex: 'group_name', width: 140, ellipsis: true },
    { title: 'Tồn đầu kỳ', dataIndex: 'opening', width: 100, align: 'right', render: num },
    { title: 'Nhập', dataIndex: 'qty_in', width: 96, align: 'right', render: num },
    { title: 'Xuất', dataIndex: 'qty_out', width: 96, align: 'right', render: num },
    { title: 'Tồn cuối kỳ', dataIndex: 'closing', width: 104, align: 'right', render: (n: number) => <b className={n < 0 ? 'neg' : undefined}>{formatQty(n)}</b> },
  ];
  const summary = d
    ? [<b key="c">Cộng</b>, <span key="n" className="muted">{d.items.length} mã</span>, null, null, ...[d.totals.opening, d.totals.qty_in, d.totals.qty_out, d.totals.closing].map((n, i) => <b key={i}>{formatQty(n)}</b>)]
    : null;
  return (
    <div className="list-page">
      <PageHeader
        title="Tổng hợp nhập – xuất – tồn"
        sub="Theo kỳ: tồn đầu, nhập, xuất, tồn cuối từng mã. Bấm mã để xem thẻ kho của kỳ đó."
        actions={<ReportActions xlsxUrl={reportApi.xlsxUrl('stock-nxt', params)} />}
      />
      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm mã, tên hàng…" style={{ width: 200 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <GroupSelect value={groupId} onChange={setGroupId} />
        <WarehouseSelect value={warehouseId} onChange={setWarehouseId} />
      </div>
      {!warehouseId && <div className="muted small-note">Xem tất cả kho: chuyển kho nội bộ không tính vào nhập/xuất (tự triệt tiêu).</div>}
      <div className="report-area">
        <PrintTitle
          title="TỔNG HỢP NHẬP XUẤT TỒN"
          filters={[
            `Từ ${formatDate(params.from)} đến ${formatDate(params.to)}`,
            warehouseId ? `Kho: ${whs.data?.items.find((w) => w.id === warehouseId)?.name ?? ''}` : 'Tất cả kho (không gồm chuyển kho nội bộ)',
            groupId && `Nhóm: ${groups.data?.items.find((g) => g.id === groupId)?.name ?? ''}`,
            dq && `Tìm: "${dq}"`,
          ]}
        />
        <ReportTable<StockNxtItem>
          columns={columns}
          rows={d?.items ?? []}
          rowKey={(r) => r.product_id}
          loading={query.isLoading}
          error={query.error}
          summary={summary}
          minWidth={900}
          onOpen={(r) => drawers.push({ kind: 'ledger', product: pick(r), warehouseId, from: params.from, to: params.to })}
        />
      </div>
      <OpenHint what="xem thẻ kho mã đó" />
    </div>
  );
}
