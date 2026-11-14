import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Segmented } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { qk } from '../../api/queryKeys';
import { reportApi, type DebtLedgerParams } from '../../api/reports';
import type { DebtLedgerRow, DebtSide } from '../../api/types';
import { DateRangeFilter, describeRange, rangeOf, type DateRangeValue } from '../../components/DateRangeFilter';
import { OpenHint, PrintTitle, ReportActions, ReportTable } from '../../components/ReportTable';
import { formatDate, formatMoney, fromApiDate, toApiDate } from '../../lib/format';
import { paths } from '../../paths';
import { useDrawers } from '../reports/drawers';

type Row = (DebtLedgerRow & { _k: 'row' }) | { _k: 'opening'; balance: number };

export interface PartnerRef {
  id: number;
  code: string;
  name: string;
}

/** Sổ chi tiết công nợ một đối tác (REQ-053/055/069): đầu kỳ, từng phiếu/phiếu thu chi, số dư lũy kế. */
export function DebtLedgerView({ partner, side: initialSide, initialFrom, initialTo }: { partner: PartnerRef; side: DebtSide; initialFrom?: string; initialTo?: string }) {
  const drawers = useDrawers();
  const navigate = useNavigate();
  const [side, setSide] = useState<DebtSide>(initialSide);
  const [range, setRange] = useState<DateRangeValue>(() =>
    initialFrom || initialTo ? { preset: 'custom', range: [fromApiDate(initialFrom), fromApiDate(initialTo)] } : { preset: 'all', range: [null, null] },
  );
  const [from, to] = rangeOf(range);
  const params: DebtLedgerParams = { partner_id: partner.id, side, from: toApiDate(from), to: toApiDate(to) };
  const q = useQuery({ queryKey: qk.report('debt-ledger', params), queryFn: () => reportApi.debtLedger(params) });
  const d = q.data;
  const rows: Row[] = useMemo(() => (d ? [{ _k: 'opening', balance: d.opening }, ...d.rows.map((r) => ({ ...r, _k: 'row' as const }))] : []), [d]);
  const money = (n: number) => (n ? formatMoney(n) : <span className="muted">-</span>);
  const columns: ColumnsType<Row> = [
    { title: 'Ngày', key: 'd', width: 100, render: (_, r) => (r._k === 'row' ? formatDate(r.date) : '') },
    { title: 'Số chứng từ', key: 'n', width: 110, render: (_, r) => (r._k === 'row' ? <span className="link-text">{r.ref_no}</span> : '') },
    { title: 'Diễn giải', key: 'x', render: (_, r) => (r._k === 'opening' ? <b>{from ? 'Số dư đầu kỳ' : 'Nợ đầu kỳ (khai báo ở danh mục)'}</b> : r.description) },
    { title: 'Tăng', key: 'i', width: 130, align: 'right', render: (_, r) => (r._k === 'row' ? money(r.increase) : '') },
    { title: side === 'receivable' ? 'Giảm (đã thu)' : 'Giảm (đã trả)', key: 'o', width: 130, align: 'right', render: (_, r) => (r._k === 'row' ? money(r.decrease) : '') },
    { title: 'Số dư', key: 'b', width: 130, align: 'right', render: (_, r) => <b className={r.balance < 0 ? 'neg' : undefined}>{formatMoney(r.balance)}</b> },
  ];
  const summary = d ? [null, null, <b key="c">Cộng — số dư cuối kỳ</b>, <b key="i">{formatMoney(d.total_increase)}</b>, <b key="o">{formatMoney(d.total_decrease)}</b>, <b key="b">{formatMoney(d.closing)}</b>] : null;
  const newVoucher = (t: 'receipt' | 'payment') => {
    drawers.clear();
    navigate(paths.newVoucher(t, { partner_id: partner.id }));
  };
  return (
    <>
      <div className="toolbar">
        <Segmented<DebtSide>
          value={side}
          onChange={setSide}
          options={[
            { label: 'Phải thu (khách nợ mình)', value: 'receivable' },
            { label: 'Phải trả (mình nợ NCC)', value: 'payable' },
          ]}
        />
        <DateRangeFilter value={range} onChange={setRange} />
        <span style={{ marginLeft: 'auto' }} />
        <Button onClick={() => newVoucher('receipt')}>Thu tiền</Button>
        <Button onClick={() => newVoucher('payment')}>Chi tiền</Button>
        <ReportActions xlsxUrl={reportApi.xlsxUrl('debt-ledger', params)} />
      </div>
      {d && (
        <div className="debt-headline">
          {side === 'receivable' ? 'Khách còn nợ' : 'Mình còn nợ'}
          {to ? ` đến ${formatDate(to)}` : ' hiện tại'}: <b className={d.closing < 0 ? 'neg' : undefined}>{formatMoney(d.closing)} đ</b>
          {d.closing < 0 && <span className="muted"> (số âm: {side === 'receivable' ? 'khách đã trả dư' : 'mình đã trả dư'})</span>}
        </div>
      )}
      <div className="report-area">
      <PrintTitle
        title={`SỔ CHI TIẾT CÔNG NỢ ${side === 'receivable' ? 'PHẢI THU' : 'PHẢI TRẢ'} — ${partner.code} ${partner.name}`}
        filters={[describeRange(range), d && `${side === 'receivable' ? 'Khách còn nợ' : 'Mình còn nợ'}: ${formatMoney(d.closing)} đ`]}
      />
      <ReportTable<Row>
        columns={columns}
        rows={rows}
        rowKey={(r, i) => (r._k === 'row' ? `${r.ref_no}-${i}` : 'opening')}
        loading={q.isLoading}
        error={q.error}
        summary={summary}
        minWidth={760}
        rowClassName={(r) => (r._k === 'opening' ? 'row-opening' : '')}
        onOpen={(r) => {
          if (r._k !== 'row') return;
          if (r.document_id) drawers.push({ kind: 'document', id: r.document_id, title: `Chứng từ ${r.ref_no}` });
          else if (r.voucher_id) drawers.push({ kind: 'voucher', id: r.voucher_id, title: `Phiếu ${r.ref_no}` });
        }}
        emptyText="Không có phát sinh công nợ trong khoảng này"
      />
      </div>
      <OpenHint />
    </>
  );
}
