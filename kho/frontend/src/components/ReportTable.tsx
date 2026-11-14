import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Table, Tooltip } from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import { FileExcelOutlined, PrinterOutlined } from '@ant-design/icons';
import { errorMessage } from '../api/client';
import { download, printReport } from '../lib/download';
import { isTypingTarget } from '../lib/keyboard';
import { useElementHeight } from '../lib/useDebounced';
import { Kbd } from './Kbd';

export interface ReportTableProps<T> {
  columns: ColumnsType<T>;
  rows: T[];
  rowKey: (r: T, i: number) => string | number;
  loading?: boolean;
  error?: unknown;
  /** Ô dòng tổng, đúng thứ tự cột (null = ô trống) */
  summary?: (ReactNode | null)[] | null;
  /** Bấm / Enter vào dòng ⇒ mở chi tiết (Drawer) */
  onOpen?: (r: T) => void;
  emptyText?: ReactNode;
  minWidth?: number;
  rowClassName?: (r: T, i: number) => string;
  /** Chiều cao cố định (trong Drawer); bỏ trống = lấp đầy khung cha */
  height?: number;
}

/**
 * Bảng báo cáo dùng chung: tiêu đề cột cố định, số căn phải, dòng tổng cố định ở đáy,
 * ↑↓ chọn dòng, Enter / nhấp để mở chi tiết ngay tại chỗ (không rời báo cáo).
 */
export function ReportTable<T extends object>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  summary,
  onOpen,
  emptyText = 'Không có số liệu trong điều kiện đang lọc',
  minWidth = 900,
  rowClassName,
  height,
}: ReportTableProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const h = useElementHeight(wrapRef);
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(-1), [rows]);
  useEffect(() => {
    if (active < 0) return;
    wrapRef.current?.querySelectorAll<HTMLElement>('.ant-table-tbody tr.ant-table-row')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const avail = (height ?? h) - 41 - (summary ? 38 : 0);
  const leafCols = columns as ColumnType<T>[];

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target) || !rows.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && active >= 0 && onOpen) {
      e.preventDefault();
      const r = rows[active];
      if (r) onOpen(r);
    }
  };

  return (
    <div className={`report-table${height ? '' : ' fill'}`} ref={wrapRef} tabIndex={0} onKeyDown={onKey} style={height ? { height } : undefined}>
      <Table<T>
        size="small"
        columns={columns}
        dataSource={rows}
        rowKey={(r) => rowKey(r, rows.indexOf(r))}
        loading={loading}
        pagination={false}
        tableLayout="fixed"
        scroll={{ x: minWidth, y: Math.max(120, avail) }}
        rowClassName={(r, i) => [i === active ? 'row-active' : '', onOpen ? 'row-link' : '', rowClassName?.(r, i) ?? ''].join(' ')}
        onRow={(r, i) => ({
          onClick: () => {
            setActive(i ?? -1);
            onOpen?.(r);
          },
        })}
        locale={{ emptyText: error ? <span className="error-text">{errorMessage(error)}</span> : emptyText }}
        summary={
          summary && rows.length
            ? () => (
                <Table.Summary fixed>
                  <Table.Summary.Row className="sum-row">
                    {summary.map((c, i) => (
                      <Table.Summary.Cell key={i} index={i} align={leafCols[i]?.align}>
                        {c}
                      </Table.Summary.Cell>
                    ))}
                  </Table.Summary.Row>
                </Table.Summary>
              )
            : undefined
        }
      />
    </div>
  );
}

/** Nút Xuất Excel (file của máy chủ, đúng bộ lọc) + In. */
export function ReportActions({ xlsxUrl, canPrint = true }: { xlsxUrl?: string; canPrint?: boolean }) {
  return (
    <span className="report-actions">
      {xlsxUrl && (
        <Tooltip title="Tải file Excel đúng bộ lọc đang xem">
          <Button icon={<FileExcelOutlined />} onClick={() => download(xlsxUrl)}>
            Xuất Excel
          </Button>
        </Tooltip>
      )}
      {canPrint && (
        <Button icon={<PrinterOutlined />} onClick={printReport}>
          In
        </Button>
      )}
    </span>
  );
}

export function OpenHint({ what = 'xem chứng từ' }: { what?: string }) {
  return (
    <div className="hint-bar">
      Bấm vào dòng (hoặc <Kbd>↑</Kbd>
      <Kbd>↓</Kbd> rồi <Kbd>Enter</Kbd>) để {what} ngay tại đây · <Kbd>Esc</Kbd> đóng khung chi tiết
    </div>
  );
}

/** Tiêu đề khi In báo cáo: tên báo cáo + MỌI bộ lọc đang dùng + thời điểm in. */
export function PrintTitle({ title, filters }: { title: string; filters: (string | false | null | undefined | 0)[] }) {
  const f = filters.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return (
    <div className="print-only report-print-title">
      <div>{title}</div>
      {f.length > 0 && <div className="print-filters">{f.join(' · ')}</div>}
      <div className="print-filters">In lúc {new Date().toLocaleString('vi-VN')}</div>
    </div>
  );
}
