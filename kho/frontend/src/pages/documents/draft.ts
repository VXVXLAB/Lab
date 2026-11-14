// Mô hình phiếu đang soạn trên máy (trước khi lưu) và chuyển đổi qua lại với dữ liệu máy chủ.
import type { Dayjs } from 'dayjs';
import type { DocType, DocumentBody, DocumentFull, DocumentLineBody, Product } from '../../api/types';
import { fromApiDate, toApiDate } from '../../lib/format';
import type { PartnerLite } from './PartnerSelect';

export interface ProductLite {
  id: number;
  code: string;
  name: string;
  unit: string;
  is_service: boolean;
  sale_price?: number;
  purchase_price?: number;
}

export interface LineDraft {
  key: string;
  product: ProductLite | null;
  /** Chữ đang gõ ở ô Mã hàng (khi chưa chọn được mã) */
  codeText: string;
  description: string;
  unit: string;
  qty: number | null;
  unit_price: number | null;
  note: string;
}

export interface HeaderDraft {
  doc_date: Dayjs | null;
  partner: PartnerLite | null;
  warehouse_id: number | null;
  to_warehouse_id: number | null;
  note: string;
}

let seq = 0;
export const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyLine(): LineDraft {
  return { key: newKey(), product: null, codeText: '', description: '', unit: '', qty: null, unit_price: null, note: '' };
}

export function isBlank(l: LineDraft): boolean {
  return !l.product && !l.codeText.trim();
}

/** Luôn có đúng một dòng trống ở cuối để gõ tiếp. */
export function withTrailingBlank(lines: LineDraft[]): LineDraft[] {
  const trimmed = [...lines];
  while (trimmed.length > 1 && isBlank(trimmed[trimmed.length - 1]!) && isBlank(trimmed[trimmed.length - 2]!)) trimmed.pop();
  const last = trimmed[trimmed.length - 1];
  return !last || !isBlank(last) ? [...trimmed, emptyLine()] : trimmed;
}

export function fromProduct(p: Product): ProductLite {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    is_service: p.is_service,
    sale_price: p.sale_price,
    purchase_price: p.purchase_price,
  };
}

export function draftFromDoc(d: DocumentFull): { header: HeaderDraft; lines: LineDraft[] } {
  return {
    header: {
      doc_date: fromApiDate(d.doc_date),
      partner: d.partner_id
        ? { id: d.partner_id, code: d.partner_code ?? '', name: d.partner_name ?? '', phone: d.partner_phone ?? '', address: d.partner_address ?? '' }
        : null,
      warehouse_id: d.warehouse_id,
      to_warehouse_id: d.to_warehouse_id,
      note: d.note,
    },
    lines: withTrailingBlank(
      d.lines.map((l) => ({
        key: newKey(),
        product: { id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit, is_service: l.is_service },
        codeText: l.product_code,
        description: l.description,
        unit: l.unit,
        qty: l.qty,
        unit_price: l.unit_price,
        note: l.note,
      })),
    ),
  };
}

export function lineAmount(l: LineDraft): number {
  if (l.qty === null || l.unit_price === null) return 0;
  return Math.round(l.qty * l.unit_price);
}

/** Dòng thật sự gửi lên (bỏ dòng trống), kèm vị trí trong lưới để báo lỗi đúng dòng. */
export function sentLines(lines: LineDraft[]): LineDraft[] {
  return lines.filter((l) => !isBlank(l));
}

export function toBody(type: DocType, h: HeaderDraft, lines: LineDraft[]): DocumentBody {
  return {
    doc_type: type,
    doc_date: toApiDate(h.doc_date) ?? '',
    partner_id: h.partner?.id ?? null,
    warehouse_id: h.warehouse_id,
    to_warehouse_id: type === 'transfer' ? h.to_warehouse_id : null,
    note: h.note.trim(),
    lines: sentLines(lines).map(
      (l): DocumentLineBody => ({
        product_id: l.product?.id ?? 0,
        description: l.description.trim(),
        unit: l.unit,
        qty: l.qty,
        unit_price: type === 'transfer' ? null : l.unit_price,
        note: l.note,
      }),
    ),
  };
}

/** Chuỗi so sánh để biết phiếu có thay đổi chưa lưu. */
export function fingerprint(type: DocType, h: HeaderDraft, lines: LineDraft[]): string {
  const b = toBody(type, h, lines);
  const unresolved = sentLines(lines).filter((l) => !l.product).map((l) => l.codeText);
  return JSON.stringify([b, unresolved]);
}

// ---------- Thay đổi của máy này so với bản đã nạp (dùng khi xung đột hai máy, F-01) ----------
export type LineChangeKind = 'added' | 'edited' | 'removed';
export interface LineChange {
  kind: LineChangeKind;
  line: LineDraft;
  /** Giá trị lúc nạp (dòng sửa / xóa) */
  before?: LineDraft;
}

const sig = (l: LineDraft) => JSON.stringify([l.product?.id ?? null, l.description.trim(), l.unit, l.qty, l.unit_price, l.note.trim()]);
const sameItem = (a: LineDraft, b: LineDraft) =>
  !!a.product && !!b.product && a.product.id === b.product.id && (!a.product.is_service || a.description.trim() === b.description.trim());

/** Chỉ những gì máy này đã thêm, sửa, xóa kể từ lúc nạp phiếu (dòng giữ nguyên không tính). */
export function diffLines(base: LineDraft[], cur: LineDraft[]): LineChange[] {
  const baseByKey = new Map(base.filter((l) => !isBlank(l)).map((l) => [l.key, l]));
  const out: LineChange[] = [];
  const seen = new Set<string>();
  for (const l of sentLines(cur)) {
    if (!l.product) continue;
    const b = baseByKey.get(l.key);
    seen.add(l.key);
    if (!b) out.push({ kind: 'added', line: l });
    else if (sig(b) !== sig(l)) out.push({ kind: 'edited', line: l, before: b });
  }
  for (const b of baseByKey.values()) if (!seen.has(b.key)) out.push({ kind: 'removed', line: b, before: b });
  return out;
}

/**
 * Đưa thay đổi của máy này vào bản mới của máy khác, KHÔNG lặp dòng:
 * thêm ⇒ thêm nếu bản mới chưa có dòng giống hệt; sửa ⇒ sửa dòng cùng mặt hàng (ưu tiên dòng máy kia chưa đổi),
 * không thấy thì thêm; xóa ⇒ chỉ xóa nếu dòng đó trên bản mới vẫn y như lúc nạp.
 */
export function applyChanges(server: LineDraft[], changes: LineChange[]): LineDraft[] {
  let out = server.filter((l) => !isBlank(l)).map((l) => ({ ...l }));
  for (const c of changes) {
    if (c.kind === 'added') {
      if (!out.some((l) => sig(l) === sig(c.line))) out.push({ ...c.line, key: newKey() });
    } else if (c.kind === 'edited' && c.before) {
      const before = c.before;
      const idx = out.findIndex((l) => sig(l) === sig(before));
      const j = idx >= 0 ? idx : out.findIndex((l) => sameItem(l, before));
      if (j >= 0) out[j] = { ...out[j]!, description: c.line.description, unit: c.line.unit, qty: c.line.qty, unit_price: c.line.unit_price, note: c.line.note };
      else out.push({ ...c.line, key: newKey() });
    } else if (c.kind === 'removed' && c.before) {
      const before = c.before;
      const idx = out.findIndex((l) => sig(l) === sig(before));
      if (idx >= 0) out = out.filter((_, i) => i !== idx);
    }
  }
  return withTrailingBlank(out);
}
