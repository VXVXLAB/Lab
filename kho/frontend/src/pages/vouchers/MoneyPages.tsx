import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Checkbox, Input, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import { cashAccountsApi } from '../../api/catalog';
import { qk } from '../../api/queryKeys';
import { reportApi, type CashBookParams, type DebtSummaryParams } from '../../api/reports';
import type { CashBookRow, DebtSide, DebtSummaryItem } from '../../api/types';
import { DateRangeFilter, describeRange, rangeOf, type DateRangeValue } from '../../components/DateRangeFilter';
import { PageHeader } from '../../components/PageHeader';
import { OpenHint, PrintTitle, ReportActions, ReportTable } from '../../components/ReportTable';
import { formatDate, formatMoney, toApiDate } from '../../lib/format';
import { useDebounced } from '../../lib/useDebounced';
import { useDrawers } from '../reports/drawers';

/** Tổng hợp công nợ phải thu / phải trả (REQ-052/054/065). Bấm dòng ⇒ sổ chi tiết của đối tác. */
export function DebtSummaryPage({ side }: { side: DebtSide }) {
  const drawers = useDrawers();
  const rec = side === 'receivable';
  const [range, setRange] = useState<DateRangeValue>({ preset: 'all', range: [null, null] });
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 300);
  const [zero, setZero] = useState(false);
  const [from, to] = rangeOf(range);
  const params: DebtSummaryParams = useMemo(
    () => ({ side, from: toApiDate(from), to: toApiDate(to), q: dq || undefined, include_zero: zero || undefined }),
    [side, from?.valueOf(), to?.valueOf(), dq, zero], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const query = useQuery({ queryKey: qk.report('debt-summary', params), queryFn: () => reportApi.debtSummary(params) });
  const d = query.data;
  const money = (n: number) => (n ? formatMoney(n) : <span className="muted">-</span>);
  const columns: ColumnsType<DebtSummaryItem> = [
    { title: 'Mã', dataIndex: 'partner_code', width: 120, ellipsis: true, className: 'col-code' },
    { title: rec ? 'Khách hàng' : 'Nhà cung cấp', dataIndex: 'partner_name', ellipsis: true },
    { title: 'Điện thoại', dataIndex: 'phone', width: 130 },
    { title: 'Đầu kỳ', dataIndex: 'opening', width: 130, align: 'right', render: money },
    { title: 'Tăng', dataIndex: 'increase', width: 130, align: 'right', render: money },
    { title: rec ? 'Giảm (đã thu)' : 'Giảm (đã trả)', dataIndex: 'decrease', width: 130, align: 'right', render: money },
    { title: rec ? 'Khách còn nợ' : 'Mình còn nợ', dataIndex: 'closing', width: 130, align: 'right', render: (n: number) => <b className={n < 0 ? 'neg' : undefined}>{formatMoney(n)}</b> },
  ];
  const t = d?.totals;
  const summary = t ? [<b key="c">Cộng</b>, <span key="n" className="muted">{d.items.length} đối tác</span>, null, ...[t.opening, t.increase, t.decrease, t.closing].map((n, i) => <b key={i}>{formatMoney(n)}</b>)] : null;
  const title = rec ? 'Công nợ phải thu khách hàng' : 'Công nợ phải trả nhà cung cấp';
  return (
    <div className="list-page">
      <PageHeader
        title={title}
        sub={rec ? 'Đầu kỳ + Tăng (bán hàng, trả lại tiền khách) − Giảm (đã thu, khách trả hàng) = Khách còn nợ. Bấm dòng để xem sổ chi tiết.' : 'Đầu kỳ + Tăng (mua hàng, NCC hoàn tiền) − Giảm (đã trả, trả hàng NCC) = Mình còn nợ. Bấm dòng để xem sổ chi tiết.'}
        actions={<ReportActions xlsxUrl={reportApi.xlsxUrl('debt-summary', params)} />}
      />
      <div className="toolbar">
        <DateRangeFilter value={range} onChange={setRange} />
        <Input allowClear prefix={<SearchOutlined />} placeholder="Tìm mã, tên, điện thoại…" style={{ width: 240 }} value={q} onChange={(e) => setQ(e.target.value)} />
        <Checkbox checked={zero} onChange={(e) => setZero(e.target.checked)}>
          Gồm đối tác số dư 0
        </Checkbox>
      </div>
      <div className="report-area">
        <PrintTitle title={title.toUpperCase()} filters={[describeRange(range), dq && `Tìm: "${dq}"`]} />
        <ReportTable<DebtSummaryItem>
          columns={columns}
          rows={d?.items ?? []}
          rowKey={(r) => r.partner_id}
          loading={query.isLoading}
          error={query.error}
          summary={summary}
          minWidth={980}
          onOpen={(r) => drawers.push({ kind: 'debt', partner: { id: r.partner_id, code: r.partner_code, name: r.partner_name }, side, from: params.from, to: params.to })}
          emptyText={rec ? 'Không có khách hàng nào còn nợ trong khoảng này.' : 'Không còn nợ nhà cung cấp nào trong khoảng này.'}
        />
      </div>
      <OpenHint what="xem sổ chi tiết công nợ" />
    </div>
  );
}

type CbRow = (CashBookRow & { _k: 'row' }) | { _k: 'opening'; balance: number };

/** Sổ quỹ tiền mặt / sổ tiền gửi ngân hàng: mỗi dòng tiền một dòng, tồn lũy kế. */
export function CashBookPage() {
  const drawers = useDrawers();
  const accounts = useQuery({ queryKey: qk.catalogList('cash_account', { all: true }), queryFn: () => cashAccountsApi.list({ page_size: 1000 }) });
  const [acc, setAcc] = useState<string>('kind:cash');
  const [range, setRange] = useState<DateRangeValue>({ preset: 'month', range: [null, null] });
  const [from, to] = rangeOf(range);
  const params: CashBookParams = useMemo(() => {
    const base = { from: toApiDate(from), to: toApiDate(to) };
    return acc.startsWith('kind:') ? { ...base, kind: acc.slice(5) as 'cash' | 'bank' } : { ...base, account_id: Number(acc) };
  }, [acc, from?.valueOf(), to?.valueOf()]); // eslint-disable-line react-hooks/exhaustive-deps
  const query = useQuery({ queryKey: qk.report('cash-book', params), queryFn: () => reportApi.cashBook(params) });
  const d = query.data;
  const rows: CbRow[] = useMemo(() => (d ? [{ _k: 'opening', balance: d.opening }, ...d.rows.map((r) => ({ ...r, _k: 'row' as const }))] : []), [d]);
  const money = (n: number) => (n ? formatMoney(n) : <span className="muted">-</span>);
  const columns: ColumnsType<CbRow> = [
    { title: 'Ngày', key: 'd', width: 100, render: (_, r) => (r._k === 'row' ? formatDate(r.date) : '') },
    { title: 'Số phiếu', key: 'n', width: 96, render: (_, r) => (r._k === 'row' ? <span className="link-text">{r.voucher_no}</span> : '') },
    ...(acc.startsWith('kind:') ? [{ title: 'TK', key: 'a', width: 56, render: (_: unknown, r: CbRow) => (r._k === 'row' ? r.account_code : '') }] : []),
    { title: 'Đối tác', key: 'p', width: 210, ellipsis: true, render: (_, r) => (r._k === 'row' ? (r.partner_name ?? <span className="muted">thu/chi khác</span>) : '') },
    { title: 'Diễn giải', key: 'x', ellipsis: true, render: (_, r) => (r._k === 'opening' ? <b>Tồn đầu kỳ</b> : r.description) },
    { title: 'Thu', key: 'r', width: 130, align: 'right', render: (_, r) => (r._k === 'row' ? money(r.receipt) : '') },
    { title: 'Chi', key: 'c', width: 130, align: 'right', render: (_, r) => (r._k === 'row' ? money(r.payment) : '') },
    { title: 'Tồn', key: 'b', width: 140, align: 'right', render: (_, r) => <b className={r.balance < 0 ? 'neg' : undefined}>{formatMoney(r.balance)}</b> },
  ];
  const kindCol = acc.startsWith('kind:') ? 1 : 0;
  const summary = d ? [<b key="c">Cộng</b>, null, ...Array(kindCol).fill(null), null, <b key="t">Tồn cuối kỳ</b>, <b key="r">{formatMoney(d.total_receipt)}</b>, <b key="p">{formatMoney(d.total_payment)}</b>, <b key="b">{formatMoney(d.closing)}</b>] : null;
  const accItems = accounts.data?.items ?? [];
  const accLabel = acc === 'kind:cash' ? 'Tất cả quỹ tiền mặt' : acc === 'kind:bank' ? 'Tất cả tài khoản ngân hàng' : (accItems.find((a) => String(a.id) === acc)?.name ?? '');
  const isBank = acc === 'kind:bank' || accItems.find((a) => String(a.id) === acc)?.kind === 'bank';
  const title = isBank ? 'Sổ tiền gửi ngân hàng' : 'Sổ quỹ tiền mặt';
  return (
    <div className="list-page">
      <PageHeader title={title} sub="Mỗi dòng tiền của phiếu thu/chi là một dòng sổ, có tồn lũy kế. Bấm dòng để xem phiếu." actions={<ReportActions xlsxUrl={reportApi.xlsxUrl('cash-book', params)} />} />
      <div className="toolbar">
        <Select<string>
          value={acc}
          onChange={setAcc}
          style={{ width: 300 }}
          aria-label="Tài khoản tiền"
          options={[
            { label: 'Tất cả quỹ tiền mặt', value: 'kind:cash' },
            { label: 'Tất cả tài khoản ngân hàng', value: 'kind:bank' },
            ...accItems.map((a) => ({ label: `${a.code} – ${a.name}`, value: String(a.id) })),
          ]}
        />
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      {d && (
        <div className="debt-headline">
          {accLabel}: tồn đầu kỳ <b>{formatMoney(d.opening)}</b> · thu <b>{formatMoney(d.total_receipt)}</b> · chi <b>{formatMoney(d.total_payment)}</b> · tồn cuối{' '}
          <b className={d.closing < 0 ? 'neg' : undefined}>{formatMoney(d.closing)} đ</b>
        </div>
      )}
      <div className="report-area">
        <PrintTitle title={title.toUpperCase()} filters={[accLabel, describeRange(range)]} />
        <ReportTable<CbRow>
          columns={columns}
          rows={rows}
          rowKey={(r, i) => (r._k === 'row' ? `${r.voucher_id}-${r.line_no}-${i}` : 'opening')}
          loading={query.isLoading}
          error={query.error}
          summary={summary}
          minWidth={960}
          rowClassName={(r) => (r._k === 'opening' ? 'row-opening' : '')}
          onOpen={(r) => r._k === 'row' && drawers.push({ kind: 'voucher', id: r.voucher_id, title: `Phiếu ${r.voucher_no}` })}
          emptyText="Không có thu chi trong khoảng này"
        />
      </div>
      <OpenHint what="xem phiếu thu/chi" />
    </div>
  );
}
