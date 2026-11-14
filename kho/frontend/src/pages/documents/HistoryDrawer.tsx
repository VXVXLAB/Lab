import { Alert, Drawer, Empty, Skeleton, Tag, Timeline } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { documentsApi } from '../../api/documents';
import { errorMessage } from '../../api/client';
import type { DocumentFull, DocumentHistoryEntry, DocumentLine, HistoryAction } from '../../api/types';
import { formatDate, formatDateTime, formatMoney, formatQty } from '../../lib/format';

const ACTION: Record<HistoryAction, { label: string; color: string }> = {
  created: { label: 'Lập phiếu', color: 'blue' },
  updated: { label: 'Sửa phiếu', color: 'orange' },
  posted: { label: 'Ghi sổ', color: 'green' },
  unposted: { label: 'Bỏ ghi sổ', color: 'red' },
  deleted: { label: 'Xóa phiếu', color: 'red' },
};

function lineLabel(l: DocumentLine): string {
  return l.is_service ? `DV "${l.description}"` : `${l.product_code} ${l.product_name}`;
}

function lineValue(l: DocumentLine): string {
  return `SL ${formatQty(l.qty)}${l.unit_price === null ? '' : ` × ${formatMoney(l.unit_price)}`}`;
}

/** Các thay đổi dễ đọc giữa hai bản phiếu. */
export function describeChanges(before: DocumentFull | null, after: DocumentFull | null): string[] {
  if (!before || !after) return [];
  const out: string[] = [];
  const cmp = (label: string, a: string | null | undefined, b: string | null | undefined) => {
    if ((a ?? '') !== (b ?? '')) out.push(`${label}: ${a || '(trống)'} → ${b || '(trống)'}`);
  };
  cmp('Ngày', formatDate(before.doc_date), formatDate(after.doc_date));
  cmp('Đối tác', before.partner_name, after.partner_name);
  cmp('Kho', before.warehouse_name, after.warehouse_name);
  cmp('Kho nhận', before.to_warehouse_name, after.to_warehouse_name);
  cmp('Ghi chú', before.note, after.note);

  const keyOf = (l: DocumentLine) => (l.is_service ? `dv|${l.description}` : `p|${l.product_id}`);
  const group = (ls: DocumentLine[]) => {
    const m = new Map<string, DocumentLine[]>();
    for (const l of ls) m.set(keyOf(l), [...(m.get(keyOf(l)) ?? []), l]);
    return m;
  };
  const ga = group(before.lines);
  const gb = group(after.lines);
  for (const [k, as] of ga) {
    const bs = gb.get(k) ?? [];
    as.forEach((a, i) => {
      const b = bs[i];
      if (!b) out.push(`Bỏ dòng ${lineLabel(a)} (${lineValue(a)})`);
      else {
        const ch: string[] = [];
        if (a.qty !== b.qty) ch.push(`SL ${formatQty(a.qty)} → ${formatQty(b.qty)}`);
        if (a.unit_price !== b.unit_price) ch.push(`đơn giá ${formatMoney(a.unit_price) || 'trống'} → ${formatMoney(b.unit_price) || 'trống'}`);
        if (ch.length) out.push(`${lineLabel(a)}: ${ch.join(', ')}`);
      }
    });
    bs.slice(as.length).forEach((b) => out.push(`Thêm dòng ${lineLabel(b)} (${lineValue(b)})`));
  }
  for (const [k, bs] of gb) if (!ga.has(k)) bs.forEach((b) => out.push(`Thêm dòng ${lineLabel(b)} (${lineValue(b)})`));
  if (before.total_amount !== after.total_amount)
    out.push(`Tổng tiền: ${formatMoney(before.total_amount)} → ${formatMoney(after.total_amount)}`);
  return out;
}

function Entry({ e }: { e: DocumentHistoryEntry }) {
  const a = ACTION[e.action];
  const changes = e.action === 'updated' ? describeChanges(e.before, e.after) : [];
  return (
    <div className="hist-entry">
      <div>
        <Tag color={a.color}>{a.label}</Tag>
        <b>{e.user_name}</b> <span className="muted">· {formatDateTime(e.at)}</span>
      </div>
      {e.action === 'created' && e.after && (
        <div className="muted">
          {e.after.lines.length} dòng · tổng {formatMoney(e.after.total_amount)}
        </div>
      )}
      {e.action === 'posted' && e.after?.doc_no && <div className="muted">Số chính thức {e.after.doc_no}</div>}
      {e.action === 'unposted' && <div className="muted">Trở về phiếu tạm (giữ số {e.before?.doc_no})</div>}
      {e.action === 'updated' &&
        (changes.length ? (
          <ul className="hist-changes">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : (
          <div className="muted">Không đổi nội dung</div>
        ))}
    </div>
  );
}

export function HistoryDrawer({ id, open, onClose }: { id: number; open: boolean; onClose: () => void }) {
  const q = useQuery({ queryKey: ['document', id, 'history'], queryFn: () => documentsApi.history(id), enabled: open });
  return (
    <Drawer open={open} onClose={onClose} title="Lịch sử sửa phiếu" width={480}>
      {q.isLoading ? (
        <Skeleton active />
      ) : q.isError ? (
        <Alert type="error" message={errorMessage(q.error)} />
      ) : !q.data?.items.length ? (
        <Empty description="Chưa có lịch sử" />
      ) : (
        <Timeline items={[...q.data.items].reverse().map((e) => ({ color: ACTION[e.action].color, children: <Entry e={e} /> }))} />
      )}
    </Drawer>
  );
}
