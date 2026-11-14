import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Input, Select, Table, type InputRef } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { cashAccountsApi } from '../../api/catalog';
import { errorMessage } from '../../api/client';
import { qk } from '../../api/queryKeys';
import type { VoucherSummary, VoucherType } from '../../api/types';
import { vouchersApi, type VoucherListParams } from '../../api/vouchers';
import { DateRangeFilter, rangeOf, type DateRangeValue } from '../../components/DateRangeFilter';
import { Kbd } from '../../components/Kbd';
import { PageHeader } from '../../components/PageHeader';
import { formatDate, formatDateTime, formatMoney, toApiDate } from '../../lib/format';
import { isTypingTarget, useHotkeys } from '../../lib/keyboard';
import { useDebounced, useElementHeight } from '../../lib/useDebounced';
import { paths } from '../../paths';
import { PartnerSelect, type PartnerLite } from '../documents/PartnerSelect';

const PAGE_SIZE = 50;

/** Danh sách phiếu thu hoặc phiếu chi (tiền mặt và ngân hàng). */
export function VoucherListPage({ type }: { type: VoucherType }) {
  const navigate = useNavigate();
  const isReceipt = type === 'receipt';
  const [range, setRange] = useState<DateRangeValue>({ preset: 'all', range: [null, null] });
  const [accountId, setAccountId] = useState<number | undefined>();
  const [partner, setPartner] = useState<PartnerLite | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(-1);
  const searchRef = useRef<InputRef>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const h = useElementHeight(tableRef);
  const accounts = useQuery({ queryKey: qk.catalogList('cash_account', { all: true }), queryFn: () => cashAccountsApi.list({ page_size: 1000 }) });
  const [from, to] = rangeOf(range);
  const params: VoucherListParams = useMemo(
    () => ({ type, account_id: accountId, partner_id: partner?.id, q: dq || undefined, from: toApiDate(from), to: toApiDate(to), page, page_size: PAGE_SIZE }),
    [type, accountId, partner, dq, from?.valueOf(), to?.valueOf(), page], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    setPage(1);
    setActive(-1);
  }, [accountId, partner, dq, range]);
  const query = useQuery({ queryKey: [...qk.vouchers, params], queryFn: ({ signal }) => vouchersApi.list(params, signal), placeholderData: keepPreviousData });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const cur = active >= 0 ? rows[active] : undefined;
  const open = (r: VoucherSummary) => navigate(paths.voucher(r.id));
  const focusSearch = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  useHotkeys({ F2: () => navigate(paths.newVoucher(type)), F3: focusSearch, '/': focusSearch });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target) || !rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active <= 0) focusSearch();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter' && cur) {
      e.preventDefault();
      open(cur);
    }
  };

  const columns: ColumnsType<VoucherSummary> = [
    { title: 'Số phiếu', dataIndex: 'voucher_no', width: 100, className: 'col-code' },
    { title: 'Ngày', dataIndex: 'voucher_date', width: 96, render: (d: string) => formatDate(d) },
    { title: 'Loại', key: 'k', width: 110, render: (_, r) => (r.account_kind === 'cash' ? 'Tiền mặt' : 'Ngân hàng') },
    { title: isReceipt ? 'Người nộp / khách hàng' : 'Người nhận / nhà cung cấp', dataIndex: 'partner_name', ellipsis: true, render: (s: string | null) => s ?? <span className="muted">{isReceipt ? 'thu khác' : 'chi khác'}</span> },
    { title: 'Tài khoản', dataIndex: 'account_name', width: 170, ellipsis: true },
    { title: 'Ghi chú', dataIndex: 'note', width: 180, ellipsis: true, render: (s: string) => s || <span className="muted">–</span> },
    { title: 'Dòng', dataIndex: 'line_count', width: 52, align: 'right' },
    { title: 'Số tiền', dataIndex: 'total_amount', width: 124, align: 'right', render: (n: number) => <b>{formatMoney(n)}</b> },
    { title: 'Người sửa cuối', key: 'u', width: 150, ellipsis: true, render: (_, r) => `${r.updated_by_name} · ${formatDateTime(r.updated_at).slice(0, 5)}` },
  ];
  const title = isReceipt ? 'Phiếu thu tiền' : 'Phiếu chi tiền';
  return (
    <div className="list-page">
      <PageHeader
        title={title}
        count={query.data ? total : undefined}
        sub={isReceipt ? 'Thu tiền mặt (PT) và thu qua ngân hàng — giấy báo có (BC). Một phiếu ghi được nhiều dòng tiền.' : 'Chi tiền mặt (PC) và chi qua ngân hàng — giấy báo nợ (BN). Một phiếu ghi được nhiều dòng tiền.'}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(paths.newVoucher(type))}>
            Lập {isReceipt ? 'phiếu thu' : 'phiếu chi'} <Kbd>F2</Kbd>
          </Button>
        }
      />
      <div className="toolbar">
        <Input
          ref={searchRef}
          allowClear
          className="search-box"
          style={{ width: 250 }}
          prefix={<SearchOutlined />}
          suffix={<Kbd>F3</Kbd>}
          placeholder="Số phiếu, đối tác, diễn giải…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowDown' || e.key === 'Enter') && rows.length) {
              e.preventDefault();
              setActive(0);
              tableRef.current?.focus();
            }
          }}
        />
        <DateRangeFilter value={range} onChange={setRange} />
        <Select<number>
          allowClear
          placeholder="Mọi tài khoản tiền"
          aria-label="Tài khoản tiền"
          style={{ width: 200 }}
          value={accountId}
          onChange={setAccountId}
          options={(accounts.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.code} – ${a.name}` }))}
        />
        <PartnerSelect value={partner?.id ?? null} current={partner} onChange={setPartner} noAdd allowClear placeholder="Đối tác…" style={{ width: 210 }} />
      </div>
      <div className="table-wrap" ref={tableRef} tabIndex={0} onKeyDown={onKey}>
        <Table<VoucherSummary>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={query.isLoading}
          tableLayout="fixed"
          scroll={{ x: 1000, y: Math.max(160, h - 41 - 46) }}
          rowClassName={(_, i) => (i === active ? 'row-active row-link' : 'row-link')}
          onRow={(r, i) => ({ onClick: () => setActive(i ?? -1), onDoubleClick: () => open(r) })}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            size: 'small',
            onChange: setPage,
            showTotal: (t) => (
              <span>
                {t} phiếu · Cộng tiền: <b className="sum-all">{formatMoney(query.data?.sum_total_amount ?? 0)}</b>
              </span>
            ),
          }}
          locale={{
            emptyText: query.isError ? errorMessage(query.error) : `Chưa có ${isReceipt ? 'phiếu thu' : 'phiếu chi'} nào khớp điều kiện lọc. Bấm F2 để lập phiếu mới.`,
          }}
        />
      </div>
      <div className="hint-bar">
        <Kbd>F2</Kbd> lập phiếu · <Kbd>F3</Kbd> tìm · <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> chọn · <Kbd>Enter</Kbd> hoặc nhấp đúp để mở
      </div>
    </div>
  );
}
