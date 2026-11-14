import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useActiveRow } from '../lib/useActiveRow';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Input, Segmented, Table, Tooltip, type InputRef } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { ApiError, errorMessage } from '../api/client';
import { qk } from '../api/queryKeys';
import type { CatalogEntity, ListParams, Paged } from '../api/types';
import { isTypingTarget, useHotkeys } from '../lib/keyboard';
import { useDebouncedFlush, useElementHeight } from '../lib/useDebounced';
import { useListSearchEnter } from '../lib/searchGuard';
import { Kbd } from './Kbd';
import { PageHeader } from './PageHeader';

type ActiveFilter = 'true' | 'false' | 'all';
type Extra = Record<string, string | number | boolean | undefined>;

export interface CatalogListProps<T extends { id: number; active: boolean }> {
  entity: CatalogEntity;
  title: string;
  /** Danh từ dùng trong câu thông báo: "kho", "mặt hàng", "khách hàng"… */
  noun: string;
  fetchList: (params: ListParams & Extra, signal?: AbortSignal) => Promise<Paged<T>>;
  extraParams?: Extra;
  /** Bộ lọc thêm đặt cạnh ô tìm kiếm. */
  filters?: ReactNode;
  columns: ColumnsType<T>;
  /** "KHO1 – Kho Tân Bình" để dùng trong câu hỏi xác nhận. */
  describe: (row: T) => string;
  onCreate: () => void;
  onEdit: (row: T) => void;
  onDelete?: (row: T) => Promise<unknown>;
  /** Gọi khi người dùng đồng ý "Ngừng sử dụng" thay cho xóa (sau lỗi IN_USE). */
  onDeactivate?: (row: T) => Promise<unknown>;
  searchPlaceholder?: string;
  showActiveFilter?: boolean;
  /** Danh sách không phân trang (người dùng) ⇒ lọc tìm kiếm tại chỗ. */
  clientFilter?: (row: T, q: string) => boolean;
  createLabel?: string;
  /** Bề rộng tối thiểu của bảng; màn hẹp hơn thì bảng tự cuộn ngang bên trong (trang không cuộn). */
  minWidth?: number;
  /** Nút thêm ở cột thao tác (vd. thẻ kho, lịch sử bán) */
  extraActions?: (row: T) => ReactNode;
  extraActionsWidth?: number;
}

const PAGE_SIZE = 50;

export { foldVietnamese } from '../lib/text';

/**
 * Màn danh sách danh mục dùng chung: tìm kiếm (máy chủ, không dấu), lọc Đang dùng/Ngừng dùng,
 * phân trang, chọn dòng bằng phím, thêm/sửa/xóa với xác nhận rõ ràng.
 */
export function CatalogList<T extends { id: number; active: boolean }>(props: CatalogListProps<T>) {
  const {
    entity,
    title,
    noun,
    fetchList,
    extraParams,
    filters,
    columns,
    describe,
    onCreate,
    onEdit,
    onDelete,
    onDeactivate,
    searchPlaceholder = 'Tìm theo mã, tên…',
    showActiveFilter = true,
    clientFilter,
    createLabel = 'Thêm mới',
    minWidth = 760,
    extraActions,
    extraActionsWidth = 0,
  } = props;
  const { modal, message } = App.useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [dq, flushQ] = useDebouncedFlush(q.trim(), 250);
  const [active, setActive] = useState<ActiveFilter>('true');
  const [page, setPage] = useState(1);
  const [activeIdx, setActiveIdx, activeRef] = useActiveRow();
  const searchRef = useRef<InputRef>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const wrapHeight = useElementHeight(tableRef);

  const extraKey = JSON.stringify(extraParams ?? {});
  const params = useMemo(
    () => ({
      ...(clientFilter ? {} : { q: dq || undefined, page, page_size: PAGE_SIZE }),
      active: active === 'all' ? undefined : active === 'true',
      ...extraParams,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!clientFilter, dq, page, active, extraKey],
  );

  const query = useQuery({
    queryKey: qk.catalogList(entity, params),
    queryFn: ({ signal }) => fetchList(params, signal),
    placeholderData: keepPreviousData,
  });

  // Đổi điều kiện lọc ⇒ về trang 1
  useEffect(() => {
    setPage(1);
    setActiveIdx(-1);
  }, [dq, active, extraKey]);

  const rows = useMemo(() => {
    let items = query.data?.items ?? [];
    if (clientFilter) {
      if (active !== 'all') items = items.filter((r) => r.active === (active === 'true'));
      if (dq) items = items.filter((r) => clientFilter(r, dq));
    }
    return items;
  }, [query.data, clientFilter, dq, active]);

  const total = clientFilter ? rows.length : (query.data?.total ?? 0);
  const current = activeIdx >= 0 ? rows[activeIdx] : undefined;

  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.catalog(entity) });

  const askDelete = (row: T) => {
    if (!onDelete) return;
    modal.confirm({
      title: `Xóa ${noun} này?`,
      content: (
        <>
          <b>{describe(row)}</b>
          <div style={{ marginTop: 6 }}>Xóa xong không khôi phục được.</div>
        </>
      ),
      okText: 'Xóa',
      okButtonProps: { danger: true },
      cancelText: 'Không xóa',
      autoFocusButton: 'cancel',
      onOk: async () => {
        try {
          await onDelete(row);
          message.success(`Đã xóa ${noun} ${describe(row)}`, 1.5);
          invalidate();
          setActiveIdx((i) => Math.min(i, rows.length - 2));
        } catch (e) {
          if (e instanceof ApiError && e.code === 'IN_USE' && onDeactivate && row.active) {
            offerDeactivate(row, e.message);
          } else {
            modal.error({ title: 'Không xóa được', content: errorMessage(e), okText: 'Đã hiểu' });
          }
        }
      },
    });
  };

  const offerDeactivate = (row: T, reason: string) => {
    modal.confirm({
      title: 'Không xóa được',
      content: (
        <>
          <div>{reason}</div>
          <div style={{ marginTop: 8 }}>
            Chuyển <b>{describe(row)}</b> sang <b>Ngừng sử dụng</b>? Chứng từ cũ vẫn giữ nguyên, chỉ không chọn được ở phiếu mới.
          </div>
        </>
      ),
      okText: 'Chuyển sang ngừng sử dụng',
      cancelText: 'Để nguyên',
      onOk: async () => {
        try {
          await onDeactivate?.(row);
          message.success(`Đã chuyển ${describe(row)} sang ngừng sử dụng`, 1.5);
          invalidate();
        } catch (err) {
          modal.error({ title: 'Không lưu được', content: errorMessage(err), okText: 'Đã hiểu' });
        }
      },
    });
  };

  const onSearchEnter = useListSearchEnter({
    text: q,
    committed: dq,
    flush: flushQ,
    fresh: !query.isPlaceholderData && !query.isFetching,
    rows,
    focusFirst: () => {
      setActiveIdx(0);
      tableRef.current?.focus();
    },
    openFirst: (r) => onEdit(r),
  });

  const focusSearch = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };

  useHotkeys({ F2: onCreate, F3: focusSearch, '/': focusSearch });

  // Giữ dòng đang chọn trong tầm nhìn
  useEffect(() => {
    if (!current) return;
    const tr = tableRef.current?.querySelector<HTMLElement>(`tr[data-row-key="${current.id}"]`);
    tr?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const onTableKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target)) return;
    const n = rows.length;
    if (!n) return;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIdx((i) => Math.min(n - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (activeIdx <= 0) {
          setActiveIdx(-1);
          focusSearch();
        } else setActiveIdx(activeIdx - 1);
        break;
      case 'Home':
        e.preventDefault();
        setActiveIdx(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIdx(n - 1);
        break;
      case 'PageDown':
        if (!clientFilter && page < pageCount) {
          e.preventDefault();
          setPage(page + 1);
          setActiveIdx(0);
        }
        break;
      case 'PageUp':
        if (!clientFilter && page > 1) {
          e.preventDefault();
          setPage(page - 1);
          setActiveIdx(0);
        }
        break;
      case 'Enter': {
        // đọc dòng chọn từ ref: Enter đến ngay sau khi chọn dòng (trước khi vẽ lại) vẫn mở đúng dòng (F-15)
        const now = activeRef.current >= 0 ? rows[activeRef.current] : undefined;
        if (now) {
          e.preventDefault();
          onEdit(now);
        }
        break;
      }
      case 'Delete':
        if (current && onDelete) {
          e.preventDefault();
          askDelete(current);
        }
        break;
    }
  };

  const actionCol: ColumnType<T> = {
    key: '__actions',
    title: '',
    width: (onDelete ? 84 : 48) + extraActionsWidth,
    align: 'center',
    fixed: 'right',
    render: (_, row) => (
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        {extraActions?.(row)}
        <Tooltip title="Sửa (Enter)">
          <Button type="text" size="small" icon={<EditOutlined />} aria-label="Sửa" onClick={() => onEdit(row)} />
        </Tooltip>
        {onDelete && (
          <Tooltip title="Xóa (Delete)">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} aria-label="Xóa" onClick={() => askDelete(row)} />
          </Tooltip>
        )}
      </span>
    ),
  };

  return (
    <div className="list-page">
      <PageHeader
        title={title}
        count={query.data ? total : undefined}
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
            {createLabel} <Kbd>F2</Kbd>
          </Button>
        }
      />
      <div className="toolbar">
        <Input
          ref={searchRef}
          allowClear
          className="search-box"
          prefix={<SearchOutlined />}
          suffix={<Kbd>F3</Kbd>}
          placeholder={searchPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearchEnter(e);
            else if (e.key === 'ArrowDown' && rows.length && dq === q.trim()) {
              e.preventDefault();
              setActiveIdx(0);
              tableRef.current?.focus();
            } else if (e.key === 'Escape' && q) {
              setQ('');
            }
          }}
        />
        {filters}
        {showActiveFilter && (
          <Segmented<ActiveFilter>
            value={active}
            onChange={setActive}
            options={[
              { label: 'Đang dùng', value: 'true' },
              { label: 'Ngừng dùng', value: 'false' },
              { label: 'Tất cả', value: 'all' },
            ]}
          />
        )}
      </div>
      <div className="table-wrap" ref={tableRef} tabIndex={0} onKeyDown={onTableKey} aria-label={`Danh sách ${noun}`}>
        <Table<T>
          rowKey="id"
          size="small"
          columns={[...columns, actionCol]}
          dataSource={rows}
          loading={query.isLoading || (query.isFetching && query.isPlaceholderData)}
          tableLayout="fixed"
          scroll={{ x: minWidth, y: Math.max(160, wrapHeight - 41 - (clientFilter ? 0 : 46)) }}
          pagination={
            clientFilter
              ? false
              : {
                  current: page,
                  pageSize: PAGE_SIZE,
                  total,
                  showSizeChanger: false,
                  showTotal: (t, [a, b]) => `${a}–${b} / ${t}`,
                  onChange: (p) => {
                    setPage(p);
                    setActiveIdx(-1);
                  },
                  size: 'small',
                }
          }
          rowClassName={(r, i) =>
            [i === activeIdx ? 'row-active' : '', r.active ? '' : 'row-inactive'].filter(Boolean).join(' ')
          }
          onRow={(r, i) => ({
            onClick: () => setActiveIdx(i ?? -1),
            onDoubleClick: () => onEdit(r),
          })}
          locale={{
            emptyText: query.isError ? (
              <span className="error-text">{errorMessage(query.error)}</span>
            ) : dq ? (
              `Không có ${noun} nào khớp "${dq}"`
            ) : (
              `Chưa có ${noun} nào. Bấm F2 (Thêm mới) để thêm.`
            ),
          }}
        />
      </div>
      <div className="hint-bar">
        <Kbd>F2</Kbd> thêm mới · <Kbd>F3</Kbd>/<Kbd>/</Kbd> tìm · <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> chọn dòng · <Kbd>Enter</Kbd> hoặc nhấp đúp để sửa
        {onDelete && (
          <>
            {' '}
            · <Kbd>Delete</Kbd> xóa
          </>
        )}
      </div>
    </div>
  );
}

/** Cột trạng thái chuẩn. */
export function activeColumn<T extends { active: boolean }>(): ColumnType<T> {
  return {
    title: 'Trạng thái',
    dataIndex: 'active',
    width: 104,
    render: (a: boolean) => <StatusText on={a} />,
  };
}

/** Trạng thái dạng chữ + chấm màu (gọn hơn thẻ, giữ dòng bảng thấp). */
export function StatusText({ on, onText = 'Đang dùng', offText = 'Ngừng dùng' }: { on: boolean; onText?: string; offText?: string }) {
  return <span className={on ? 'status status-on' : 'status status-off'}>{on ? onText : offText}</span>;
}
