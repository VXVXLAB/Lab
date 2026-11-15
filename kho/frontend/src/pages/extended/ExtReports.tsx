// Báo cáo của bản mở rộng đợt M2: Hàng dưới tồn tối thiểu (C5), Tuổi nợ phải thu (C8), Lãi gộp (C7).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Input, Segmented, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InfoCircleOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { extReportsApi, minStockApi, type AgingParams, type ProfitParams } from '../../api/extended';
import { qk } from '../../api/queryKeys';
import type { AgingItem, AgingOpenItem, LowStockItem, ProfitGroup, ProfitRow } from '../../api/types';
import { DateInput } from '../../components/DateInput';
import { DateRangeFilter, describeRange, rangeOf, type DateRangeValue } from '../../components/DateRangeFilter';
import { PageHeader } from '../../components/PageHeader';
import { OpenHint, PrintTitle, ReportActions, ReportTable } from '../../components/ReportTable';
import { formatDate, formatMoney, formatQty, toApiDate, todayVn } from '../../lib/format';
import { DOC_TYPE_LABEL } from '../../lib/labels';
import { useDebounced } from '../../lib/useDebounced';
import { useDrawers } from '../reports/drawers';

const money = (n: number) => (n ? formatMoney(n) : <span className="muted">-</span>);

// ---------- C5: Hàng dưới mức tối thiểu ----------
export function LowStockPage() {
  const drawers = useDrawers();
  const q = useQuery({ queryKey: qk.report('low-stock', {}), queryFn: () => minStockApi.lowStock() });
  const rows = q.data?.items ?? [];
  const columns: ColumnsType<LowStockItem> = [
    { title: 'Mã hàng', dataIndex: 'code', width: 130, className: 'col-code', ellipsis: true },
    { title: 'Tên hàng', dataIndex: 'name', ellipsis: true },
    { title: 'ĐVT', dataIndex: 'unit', width: 60 },
    { title: 'Nhóm hàng', dataIndex: 'group_name', width: 150, ellipsis: true },
    { title: 'Tồn tối thiểu', dataIndex: 'min_stock', width: 110, align: 'right', render: (n: number) => formatQty(n) },
    { title: 'Tồn 4 kho', dataIndex: 'total_stock', width: 100, align: 'right', render: (n: number) => <span className={n <= 0 ? 'neg' : undefined}>{formatQty(n)}</span> },
    { title: 'Thiếu so với mức', dataIndex: 'need', width: 130, align: 'right', render: (n: number) => (n > 0 ? <b className="neg">{formatQty(n)}</b> : <span className="muted">bằng mức</span>) },
  ];
  return (
    <div className="list-page">
      <PageHeader
        title="Hàng dưới mức tối thiểu"
        sub="Mã có tồn tổng các kho ≤ tồn tối thiểu đã đặt (Danh mục › Hàng hóa). Tồn tính cả phiếu đã ghi sổ có ngày sau hôm nay. Muốn đặt hàng: Mua hàng › Hàng cần đặt."
        actions={<ReportActions xlsxUrl={minStockApi.lowStockXlsx()} />}
      />
      <div className="report-area">
        <PrintTitle title="HÀNG DƯỚI MỨC TỒN TỐI THIỂU" filters={[`Đến ${formatDate(todayVn())}`]} />
        <ReportTable<LowStockItem>
          columns={columns}
          rows={rows}
          rowKey={(r) => r.product_id}
          loading={q.isLoading}
          error={q.error}
          minWidth={820}
          onOpen={(r) => drawers.push({ kind: 'ledger', product: { id: r.product_id, code: r.code, name: r.name, unit: r.unit } })}
          emptyText="Không có mã nào dưới mức tối thiểu (hoặc chưa đặt tồn tối thiểu cho mã nào)."
        />
      </div>
      <OpenHint what="xem thẻ kho mã đó" />
    </div>
  );
}

// ---------- C8: Tuổi nợ phải thu ----------
const AGING_COLS: { key: keyof Omit<AgingItem, 'partner_id' | 'partner_code' | 'partner_name' | 'payment_days' | 'items'>; title: string; tip?: string }[] = [
  { key: 'opening', title: 'Đầu kỳ', tip: 'Nợ đầu kỳ khai báo trong danh mục (không có ngày)' },
  { key: 'in_term', title: 'Trong hạn', tip: 'Chưa tới hạn trả (ngày phát sinh + số ngày được nợ)' },
  { key: 'd1_30', title: '1–30 ngày' },
  { key: 'd31_60', title: '31–60 ngày' },
  { key: 'd61_90', title: '61–90 ngày' },
  { key: 'over_90', title: '> 90 ngày' },
  { key: 'prepaid', title: 'Trả trước', tip: 'Khách trả dư (số âm)' },
  { key: 'total', title: 'Tổng nợ' },
];

export function DebtAgingPage() {
  const drawers = useDrawers();
  const [asOf, setAsOf] = useState<Dayjs | null>(todayVn());
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const params: AgingParams = useMemo(() => ({ as_of: toApiDate(asOf), q: dq || undefined }), [asOf, dq]);
  const query = useQuery({ queryKey: qk.report('debt-aging', params), queryFn: () => extReportsApi.debtAging(params) });
  const d = query.data;
  const columns: ColumnsType<AgingItem> = [
    { title: 'Mã', dataIndex: 'partner_code', width: 110, className: 'col-code', ellipsis: true },
    { title: 'Khách hàng', dataIndex: 'partner_name', ellipsis: true },
    { title: 'Được nợ', dataIndex: 'payment_days', width: 76, align: 'right', render: (n: number | null) => `${n ?? 0} ngày` },
    ...AGING_COLS.map((c) => ({
      title: c.tip ? <Tooltip title={c.tip}>{c.title}</Tooltip> : c.title,
      dataIndex: c.key,
      width: c.key === 'total' ? 124 : 112,
      align: 'right' as const,
      render: (n: number) =>
        c.key === 'total' ? <b className={n < 0 ? 'neg' : undefined}>{formatMoney(n)}</b> : c.key === 'd61_90' || c.key === 'over_90' ? <span className={n ? 'neg' : undefined}>{money(n)}</span> : money(n),
    })),
  ];
  const t = d?.totals;
  const summary = t ? [<b key="c">Cộng</b>, <span key="n" className="muted">{d.items.length} khách</span>, null, ...AGING_COLS.map((c) => <b key={c.key}>{formatMoney(t[c.key])}</b>)] : null;
  return (
    <div className="list-page">
      <PageHeader
        title="Tuổi nợ phải thu"
        sub="Số khách còn nợ chia theo số ngày quá hạn (hạn = ngày phát sinh + số ngày được nợ). Tiền thu, hàng trả lại trừ vào khoản nợ cũ nhất trước. Tổng nợ khớp sổ công nợ cùng ngày. Bấm dòng để xem từng khoản còn nợ."
        actions={<ReportActions xlsxUrl={extReportsApi.debtAgingXlsx(params)} />}
      />
      <div className="toolbar">
        <span className="range">
          <span className="muted">Đến ngày</span>
          <DateInput value={asOf} onChange={(v) => setAsOf(v ?? todayVn())} style={{ width: 140 }} />
        </span>
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm mã, tên khách…" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="report-area">
        <PrintTitle title={`TUỔI NỢ PHẢI THU đến hết ngày ${formatDate(asOf)}`} filters={[dq && `Tìm: "${dq}"`]} />
        <ReportTable<AgingItem>
          columns={columns}
          rows={d?.items ?? []}
          rowKey={(r) => r.partner_id}
          loading={query.isLoading}
          error={query.error}
          summary={summary}
          minWidth={1240}
          onOpen={(r) => drawers.push({ kind: 'aging', item: r, asOf: d?.as_of ?? toApiDate(asOf) ?? '' })}
          emptyText="Không có khách hàng nào còn nợ đến ngày này."
        />
      </div>
      <OpenHint what="xem từng khoản còn nợ" />
    </div>
  );
}

const BUCKET_LABEL: Record<AgingOpenItem['bucket'], string> = {
  in_term: 'Trong hạn',
  d1_30: '1–30 ngày',
  d31_60: '31–60 ngày',
  d61_90: '61–90 ngày',
  over_90: '> 90 ngày',
};

/** Các khoản còn nợ của một khách (ngăn kéo từ báo cáo tuổi nợ). */
export function AgingItemsView({ item, asOf }: { item: AgingItem; asOf: string }) {
  const drawers = useDrawers();
  const columns: ColumnsType<AgingOpenItem> = [
    { title: 'Ngày', dataIndex: 'date', width: 96, render: (s: string) => formatDate(s) },
    { title: 'Chứng từ', dataIndex: 'ref_no', width: 110, className: 'col-code' },
    { title: 'Loại', dataIndex: 'ref_type', width: 140, render: (t: string) => DOC_TYPE_LABEL[t as keyof typeof DOC_TYPE_LABEL] ?? (t === 'payment' ? 'Phiếu chi' : t === 'receipt' ? 'Phiếu thu' : t) },
    { title: 'Hạn trả', dataIndex: 'due_date', width: 96, render: (s: string) => formatDate(s) },
    { title: 'Số tiền', dataIndex: 'amount', width: 120, align: 'right', render: (n: number) => formatMoney(n) },
    { title: 'Còn nợ', dataIndex: 'remaining', width: 120, align: 'right', render: (n: number) => <b>{formatMoney(n)}</b> },
    {
      title: 'Quá hạn',
      key: 'od',
      width: 140,
      render: (_, r) => (r.days_overdue > 0 ? <Tag color={r.bucket === 'over_90' || r.bucket === 'd61_90' ? 'red' : 'orange'}>{r.days_overdue} ngày · {BUCKET_LABEL[r.bucket]}</Tag> : <Tag color="green">Trong hạn</Tag>),
    },
  ];
  return (
    <>
      <div className="muted">
        Đến hết ngày {formatDate(asOf)} · được nợ {item.payment_days ?? 0} ngày · tổng còn nợ <b>{formatMoney(item.total)}</b>
        {item.opening ? <> · trong đó nợ đầu kỳ {formatMoney(item.opening)}</> : null}
        {item.prepaid ? <> · khách trả trước {formatMoney(item.prepaid)}</> : null}
      </div>
      <ReportTable<AgingOpenItem>
        columns={columns}
        rows={item.items}
        rowKey={(r, i) => `${r.ref_no}-${i}`}
        minWidth={860}
        height={420}
        onOpen={(r) =>
          r.document_id
            ? drawers.push({ kind: 'document', id: r.document_id, title: r.ref_no })
            : r.voucher_id
              ? drawers.push({ kind: 'voucher', id: r.voucher_id, title: r.ref_no })
              : undefined
        }
        emptyText="Không có khoản nào còn mở (nợ chỉ là nợ đầu kỳ hoặc khách trả trước)."
      />
    </>
  );
}

// ---------- C7: Lãi gộp ----------
const GROUP_LABEL: Record<ProfitGroup, string> = { document: 'Theo phiếu', product: 'Theo mặt hàng', customer: 'Theo khách' };

function profitColumns(group: ProfitGroup): ColumnsType<ProfitRow> {
  const head: ColumnsType<ProfitRow> =
    group === 'document'
      ? [
          { title: 'Số phiếu', dataIndex: 'doc_no', width: 104, className: 'col-code' },
          { title: 'Ngày', dataIndex: 'doc_date', width: 92, render: (s: string) => formatDate(s) },
          { title: 'Loại', dataIndex: 'doc_type', width: 120, render: (t: ProfitRow['doc_type']) => (t ? DOC_TYPE_LABEL[t] : '') },
          { title: 'Khách hàng', dataIndex: 'partner_name', ellipsis: true },
        ]
      : group === 'product'
        ? [
            { title: 'Mã hàng', dataIndex: 'product_code', width: 130, className: 'col-code', ellipsis: true },
            { title: 'Tên hàng', dataIndex: 'product_name', ellipsis: true },
            { title: 'SL bán ròng', dataIndex: 'qty', width: 110, align: 'right', render: (n: number, r) => `${formatQty(n)} ${r.unit ?? ''}` },
          ]
        : [
            { title: 'Mã', dataIndex: 'partner_code', width: 120, className: 'col-code', ellipsis: true },
            { title: 'Khách hàng', dataIndex: 'partner_name', ellipsis: true, render: (s: string | null) => s ?? <span className="muted">(khách lẻ / không ghi)</span> },
          ];
  return [
    ...head,
    { title: 'Doanh thu', dataIndex: 'revenue', width: 124, align: 'right', render: (n: number) => formatMoney(n) },
    {
      title: 'Giá vốn',
      dataIndex: 'cost',
      width: 124,
      align: 'right',
      render: (n: number, r) => (
        <>
          {formatMoney(n)}
          {r.estimated && <EstimatedMark />}
        </>
      ),
    },
    { title: 'Lãi gộp', dataIndex: 'profit', width: 124, align: 'right', render: (n: number) => <b className={n < 0 ? 'neg' : undefined}>{formatMoney(n)}</b> },
    { title: 'Tỷ lệ', dataIndex: 'margin', width: 76, align: 'right', render: (n: number | null) => (n === null ? <span className="muted">–</span> : `${n.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`) },
  ];
}

function EstimatedMark() {
  return (
    <Tooltip title="Ước tính: lúc bán chưa có lần nhập mua / tồn đầu kỳ nào của mã này nên giá vốn tạm lấy giá mua khai báo trong danh mục.">
      <span className="est-mark"> ước tính</span>
    </Tooltip>
  );
}

function profitSummary(group: ProfitGroup, d: { items: ProfitRow[]; totals: { revenue: number; cost: number; profit: number; margin: number | null; estimated: boolean } }) {
  const t = d.totals;
  const lead = group === 'document' ? 4 : group === 'product' ? 3 : 2;
  return [
    <b key="c">Cộng</b>,
    <span key="n" className="muted">
      {d.items.length} {group === 'document' ? 'phiếu' : group === 'product' ? 'mã' : 'khách'}
    </span>,
    ...Array.from({ length: lead - 2 }, () => null),
    <b key="r">{formatMoney(t.revenue)}</b>,
    <b key="k">
      {formatMoney(t.cost)}
      {t.estimated && <EstimatedMark />}
    </b>,
    <b key="p" className={t.profit < 0 ? 'neg' : undefined}>
      {formatMoney(t.profit)}
    </b>,
    <b key="m">{t.margin === null ? '–' : `${t.margin.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`}</b>,
  ];
}

const HOW =
  'Giá vốn tính theo bình quân gia quyền sau mỗi lần nhập, chung các kho: mỗi lần nhập mua / tồn đầu kỳ thì tính lại giá bình quân; hàng bán ra lấy giá bình quân lúc bán; khách trả hàng nhập lại theo giá bình quân đó; dịch vụ giá vốn 0. Sửa hoặc nhập lùi ngày phiếu mua làm thay đổi lãi các kỳ sau đó.';

export function ProfitPage() {
  const drawers = useDrawers();
  const [group, setGroup] = useState<ProfitGroup>('document');
  const [range, setRange] = useState<DateRangeValue>({ preset: 'month', range: [null, null] });
  const [from, to] = rangeOf(range);
  const params: ProfitParams = useMemo(
    () => ({ group_by: group, from: toApiDate(from), to: toApiDate(to) }),
    [group, from?.valueOf(), to?.valueOf()], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const q = useQuery({ queryKey: qk.report('profit', params), queryFn: () => extReportsApi.profit(params) });
  const d = q.data;
  const open = (r: ProfitRow) => {
    if (group === 'document' && r.document_id) drawers.push({ kind: 'document', id: r.document_id, title: r.doc_no });
    else if (group === 'product' && r.product_id)
      drawers.push({ kind: 'profit', title: `Lãi gộp — ${r.product_code} ${r.product_name}`, params: { group_by: 'document', from: params.from, to: params.to, product_id: r.product_id } });
    else if (group === 'customer' && r.partner_id)
      drawers.push({ kind: 'profit', title: `Lãi gộp — ${r.partner_code} ${r.partner_name}`, params: { group_by: 'document', from: params.from, to: params.to, partner_id: r.partner_id } });
  };
  return (
    <div className="list-page">
      <PageHeader title="Lãi gộp" sub="Doanh thu bán hàng (trừ khách trả hàng) − giá vốn hàng bán, theo phiếu, theo mặt hàng hoặc theo khách." actions={<ReportActions xlsxUrl={extReportsApi.profitXlsx(params)} />} />
      <div className="toolbar">
        <Segmented<ProfitGroup>
          value={group}
          onChange={setGroup}
          options={(Object.keys(GROUP_LABEL) as ProfitGroup[]).map((g) => ({ value: g, label: GROUP_LABEL[g] }))}
        />
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      <Alert className="profit-how" type="info" showIcon icon={<InfoCircleOutlined />} message={HOW} />
      {d && d.estimated_lines > 0 && (
        <Alert type="warning" showIcon message={`${d.estimated_lines} dòng bán có giá vốn ước tính (bán khi chưa có lần nhập nào) — xem chữ "ước tính" ở cột Giá vốn.`} />
      )}
      <div className="report-area">
        <PrintTitle title={`BÁO CÁO LÃI GỘP — ${GROUP_LABEL[group].toUpperCase()}`} filters={[describeRange(range)]} />
        <ReportTable<ProfitRow>
          columns={profitColumns(group)}
          rows={d?.items ?? []}
          rowKey={(r, i) => String(r.document_id ?? r.product_id ?? r.partner_id ?? `x${i}`)}
          loading={q.isLoading}
          error={q.error}
          summary={d ? profitSummary(group, d) : null}
          minWidth={group === 'document' ? 1040 : 900}
          onOpen={open}
          emptyText="Không có phiếu bán / khách trả hàng nào đã ghi sổ trong khoảng này."
        />
      </div>
      <OpenHint what={group === 'document' ? 'xem phiếu' : 'xem lãi gộp từng phiếu'} />
    </div>
  );
}

/** Lãi gộp từng phiếu của một mặt hàng / một khách (ngăn kéo). */
export function ProfitDocsView({ params }: { params: ProfitParams }) {
  const drawers = useDrawers();
  const q = useQuery({ queryKey: qk.report('profit', params), queryFn: () => extReportsApi.profit(params) });
  const d = q.data;
  return (
    <>
      <div className="muted">
        Từ {formatDate(d?.from ?? params.from)} đến {formatDate(d?.to ?? params.to)}
      </div>
      <ReportTable<ProfitRow>
        columns={profitColumns('document')}
        rows={d?.items ?? []}
        rowKey={(r, i) => String(r.document_id ?? i)}
        loading={q.isLoading}
        error={q.error}
        summary={d ? profitSummary('document', d) : null}
        minWidth={1000}
        height={460}
        onOpen={(r) => r.document_id && drawers.push({ kind: 'document', id: r.document_id, title: r.doc_no })}
      />
    </>
  );
}
