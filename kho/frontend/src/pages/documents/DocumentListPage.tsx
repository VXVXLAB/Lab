import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Dropdown, Input, Segmented, Select, Table, Tag, Tooltip, type InputRef } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { productsApi } from '../../api/catalog';
import { errorMessage } from '../../api/client';
import { documentsApi } from '../../api/documents';
import { qk } from '../../api/queryKeys';
import type { DocStatus, DocType, DocumentSummary, DocumentListParams } from '../../api/types';
import { DateInput } from '../../components/DateInput';
import { Kbd } from '../../components/Kbd';
import { PageHeader } from '../../components/PageHeader';
import { formatDate, formatDateTime, formatMoney, toApiDate, todayVn } from '../../lib/format';
import { isTypingTarget, useHotkeys } from '../../lib/keyboard';
import { useDebounced, useElementHeight } from '../../lib/useDebounced';
import { paths } from '../../paths';
import { DOC_TYPES, DOC_TYPE_LIST } from './docTypes';
import { PartnerSelect, type PartnerLite } from './PartnerSelect';

type Preset = 'all' | 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'custom';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: 'week', label: 'Tuần này' },
  { value: 'month', label: 'Tháng này' },
  { value: 'lastMonth', label: 'Tháng trước' },
  { value: 'year', label: 'Năm nay' },
  { value: 'all', label: 'Tất cả' },
  { value: 'custom', label: 'Khoảng ngày…' },
];

function presetRange(p: Preset): [Dayjs | null, Dayjs | null] {
  const t = todayVn();
  switch (p) {
    case 'today':
      return [t, t];
    case 'week': {
      const dow = (t.day() + 6) % 7; // thứ Hai đầu tuần
      return [t.subtract(dow, 'day'), t];
    }
    case 'month':
      return [t.startOf('month'), t];
    case 'lastMonth': {
      const m = t.subtract(1, 'month');
      return [m.startOf('month'), m.endOf('month')];
    }
    case 'year':
      return [t.startOf('year'), t];
    default:
      return [null, null];
  }
}

function ProductFilter({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const [s, setS] = useState('');
  const dq = useDebounced(s.trim(), 150);
  const params = useMemo(() => ({ q: dq || undefined, page_size: 30 }), [dq]);
  const q = useQuery({ queryKey: qk.catalogList('product', params), queryFn: () => productsApi.list(params), staleTime: 30_000 });
  return (
    <Select<number>
      allowClear
      showSearch
      filterOption={false}
      onSearch={setS}
      value={value}
      onChange={(v) => onChange(v)}
      placeholder="Có mặt hàng…"
      style={{ width: 200 }}
      popupMatchSelectWidth={420}
      options={(q.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }))}
    />
  );
}

function ago(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return formatDateTime(iso);
}

interface Props {
  /** Một loại (danh sách theo loại) hoặc bỏ trống = mọi loại */
  type?: DocType;
  /** Màn "Phiếu tạm đang treo" */
  draftsOnly?: boolean;
}

const PAGE_SIZE = 50;

export function DocumentListPage({ type, draftsOnly = false }: Props) {
  const navigate = useNavigate();
  const cfg = type ? DOC_TYPES[type] : null;
  const [preset, setPreset] = useState<Preset>('all');
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [status, setStatus] = useState<'all' | DocStatus>(draftsOnly ? 'draft' : 'all');
  const [partner, setPartner] = useState<PartnerLite | null>(null);
  const [productId, setProductId] = useState<number | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<DocType | undefined>(undefined);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const [page, setPage] = useState(1);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchRef = useRef<InputRef>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const wrapHeight = useElementHeight(tableRef);
  const [, setTick] = useState(0);

  // "x phút trước" tự cập nhật
  useEffect(() => {
    if (!draftsOnly) return undefined;
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [draftsOnly]);

  const [from, to] = preset === 'custom' ? range : presetRange(preset);
  const params: DocumentListParams = useMemo(
    () => ({
      type: type ?? typeFilter,
      status: status === 'all' ? undefined : status,
      partner_id: partner?.id,
      product_id: productId,
      q: dq || undefined,
      from: toApiDate(from),
      to: toApiDate(to),
      page,
      page_size: PAGE_SIZE,
    }),
    [type, typeFilter, status, partner, productId, dq, from?.valueOf(), to?.valueOf(), page], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    setPage(1);
    setActiveIdx(-1);
  }, [type, typeFilter, status, partner, productId, dq, preset, range]);

  const query = useQuery({
    queryKey: [...qk.documents, params],
    queryFn: ({ signal }) => documentsApi.list(params, signal),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const pageSum = rows.reduce((s, r) => s + r.total_amount, 0);
  const current = activeIdx >= 0 ? rows[activeIdx] : undefined;

  const open = (r: DocumentSummary) => navigate(paths.document(r.id));
  const newDoc = (t: DocType) => navigate(paths.newDocument(t));
  const focusSearch = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };
  useHotkeys({ F2: () => newDoc(type ?? 'sale'), F3: focusSearch, '/': focusSearch });

  useEffect(() => {
    if (!current) return;
    tableRef.current?.querySelector<HTMLElement>(`tr[data-row-key="${current.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const onTableKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target) || !rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeIdx <= 0) {
        setActiveIdx(-1);
        focusSearch();
      } else setActiveIdx(activeIdx - 1);
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      open(current);
    } else if (e.key === 'PageDown' && page * PAGE_SIZE < total) {
      e.preventDefault();
      setPage(page + 1);
      setActiveIdx(0);
    } else if (e.key === 'PageUp' && page > 1) {
      e.preventDefault();
      setPage(page - 1);
      setActiveIdx(0);
    }
  };

  const showPrice = !cfg || cfg.hasPrice;
  const columns: ColumnsType<DocumentSummary> = [
    {
      title: 'Số phiếu',
      dataIndex: 'display_no',
      width: 120,
      className: 'col-code',
      render: (n: string, r) => (
        <Tooltip title={r.doc_no ? `Số tạm ${r.draft_no}` : 'Số tạm — số chính thức cấp khi ghi sổ'}>
          <span className={r.status === 'draft' ? 'no-draft' : undefined}>{n}</span>
        </Tooltip>
      ),
    },
    { title: 'Ngày', dataIndex: 'doc_date', width: 96, render: (d: string) => formatDate(d) },
    ...(draftsOnly
      ? []
      : [
          {
            title: 'Trạng thái',
            dataIndex: 'status',
            width: 100,
            render: (s: DocStatus) => (s === 'draft' ? <Tag color="orange">Phiếu tạm</Tag> : <Tag color="green">Đã ghi sổ</Tag>),
          },
        ]),
    ...(!type
      ? [
          {
            title: 'Loại phiếu',
            dataIndex: 'doc_type',
            width: 140,
            render: (t: DocType) => DOC_TYPES[t].listTitle,
          },
        ]
      : []),
    {
      title: cfg?.partner ? cfg.partnerLabel : cfg ? 'Kho' : 'Đối tác / kho',
      key: 'who',
      ellipsis: true,
      width: draftsOnly || !cfg ? 260 : undefined,
      render: (_, r) =>
        r.partner_name ? (
          <span className="cell-strong">{r.partner_name}</span>
        ) : r.doc_type === 'transfer' ? (
          `${r.warehouse_name} → ${r.to_warehouse_name ?? ''}`
        ) : (
          r.warehouse_name
        ),
    },
    ...(cfg?.partner || (!cfg && !draftsOnly) ? [{ title: 'Kho', dataIndex: 'warehouse_name', width: 120, ellipsis: true }] : []),
    { title: 'Ghi chú', dataIndex: 'note', ellipsis: true, width: draftsOnly || !cfg ? undefined : 150, render: (s: string) => s || <span className="muted">–</span> },
    { title: 'Dòng', dataIndex: 'line_count', width: 50, align: 'right' },
    ...(showPrice
      ? [{ title: 'Tổng tiền', dataIndex: 'total_amount', width: 120, align: 'right' as const, render: (n: number) => formatMoney(n) }]
      : []),
    {
      title: draftsOnly ? 'Sửa lần cuối' : 'Người sửa cuối',
      key: 'upd',
      width: draftsOnly ? 200 : 150,
      ellipsis: true,
      render: (_, r) => (
        <Tooltip title={formatDateTime(r.updated_at)}>
          <span>
            {r.updated_by_name}
            <span className="cell-sub"> · {draftsOnly ? ago(r.updated_at) : formatDateTime(r.updated_at).slice(0, 5)}</span>
          </span>
        </Tooltip>
      ),
    },
  ];

  const title = draftsOnly ? 'Phiếu tạm đang treo' : (cfg?.listTitle ?? 'Chứng từ');
  return (
    <div className="list-page">
      <PageHeader
        title={title}
        count={query.data ? total : undefined}
        sub={
          draftsOnly
            ? 'Phiếu chưa ghi sổ của mọi máy — tự cập nhật khi máy khác lập/sửa. Mở phiếu để làm tiếp.'
            : undefined
        }
        actions={
          type ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => newDoc(type)}>
              Lập {cfg?.name.toLowerCase()} <Kbd>F2</Kbd>
            </Button>
          ) : (
            <Dropdown.Button
              type="primary"
              onClick={() => newDoc('sale')}
              menu={{ items: DOC_TYPE_LIST.map((t) => ({ key: t, label: DOC_TYPES[t].name })), onClick: ({ key }) => newDoc(key as DocType) }}
            >
              <PlusOutlined /> Lập phiếu bán <Kbd>F2</Kbd>
            </Dropdown.Button>
          )
        }
      />
      <div className="toolbar">
        <Input
          ref={searchRef}
          allowClear
          className="search-box"
          style={{ width: 280 }}
          prefix={<SearchOutlined />}
          suffix={<Kbd>F3</Kbd>}
          placeholder="Số phiếu, tên đối tác, ghi chú…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'ArrowDown' || e.key === 'Enter') && rows.length) {
              e.preventDefault();
              setActiveIdx(0);
              tableRef.current?.focus();
            } else if (e.key === 'Escape' && q) setQ('');
          }}
        />
        <Select<Preset> value={preset} onChange={setPreset} options={PRESETS} style={{ width: 132 }} aria-label="Khoảng thời gian" />
        {preset === 'custom' && (
          <span className="range">
            <DateInput value={range[0]} onChange={(d) => setRange([d, range[1]])} style={{ width: 130 }} placeholder="Từ ngày" />
            <span className="muted">→</span>
            <DateInput value={range[1]} onChange={(d) => setRange([range[0], d])} style={{ width: 130 }} placeholder="Đến ngày" />
          </span>
        )}
        {preset !== 'all' && preset !== 'custom' && from && (
          <span className="muted range-text">
            {formatDate(from)} – {formatDate(to)}
          </span>
        )}
        {!draftsOnly && (
          <Segmented<'all' | DocStatus>
            value={status}
            onChange={setStatus}
            options={[
              { label: 'Tất cả', value: 'all' },
              { label: 'Phiếu tạm', value: 'draft' },
              { label: 'Đã ghi sổ', value: 'posted' },
            ]}
          />
        )}
        {!type && (
          <Select<DocType>
            allowClear
            placeholder="Mọi loại phiếu"
            style={{ width: 170 }}
            value={typeFilter}
            onChange={setTypeFilter}
            options={DOC_TYPE_LIST.map((t) => ({ value: t, label: DOC_TYPES[t].listTitle }))}
          />
        )}
        {(!cfg || cfg.partner) && (
          <PartnerSelect
            type={cfg?.partner ?? undefined}
            value={partner?.id ?? null}
            current={partner}
            onChange={setPartner}
            noAdd
            allowClear
            placeholder={cfg?.partner ? `${cfg.partnerLabel}…` : 'Đối tác…'}
            style={{ width: 220 }}
          />
        )}
        <ProductFilter value={productId} onChange={setProductId} />
      </div>
      <div className="table-wrap" ref={tableRef} tabIndex={0} onKeyDown={onTableKey} aria-label={`Danh sách ${title}`}>
        <Table<DocumentSummary>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          loading={query.isLoading || (query.isFetching && query.isPlaceholderData)}
          tableLayout="fixed"
          scroll={{ x: 1000, y: Math.max(160, wrapHeight - 41 - 46) }}
          rowClassName={(r, i) =>
            [
              i === activeIdx ? 'row-active' : '',
              r.status === 'draft' ? 'row-draft' : '',
              draftsOnly && Date.now() - new Date(r.updated_at).getTime() < 5 * 60_000 ? 'row-fresh' : '',
              'row-link',
            ]
              .filter(Boolean)
              .join(' ')
          }
          onRow={(r, i) => ({ onClick: () => setActiveIdx(i ?? -1), onDoubleClick: () => open(r) })}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            size: 'small',
            onChange: (p) => {
              setPage(p);
              setActiveIdx(-1);
            },
            showTotal: (t, [a, b]) => (
              <span>
                {a}–{b} / {t} phiếu
                {showPrice && rows.length > 0 && (
                  <>
                    {' '}
                    · Cộng tiền trang này: <b>{formatMoney(pageSum)}</b>
                  </>
                )}
              </span>
            ),
          }}
          locale={{
            emptyText: query.isError
              ? errorMessage(query.error)
              : draftsOnly
                ? 'Không có phiếu tạm nào đang treo.'
                : 'Không có phiếu nào khớp điều kiện lọc. Thử chọn "Tất cả" thời gian.',
          }}
        />
      </div>
      <div className="hint-bar">
        <Kbd>F2</Kbd> lập phiếu · <Kbd>F3</Kbd>/<Kbd>/</Kbd> tìm · <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> chọn · <Kbd>Enter</Kbd> hoặc nhấp đúp để mở phiếu
      </div>
    </div>
  );
}

