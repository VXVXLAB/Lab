// Mô hình phiếu đang soạn trên máy (trước khi lưu) và chuyển đổi qua lại với dữ liệu máy chủ.
import type { Dayjs } from 'dayjs';
import type { DocType, DocumentBody, DocumentFull, DocumentLineBody, Product } from '../../api/types';
import { formatMoney, formatQty, fromApiDate, toApiDate } from '../../lib/format';
import { applyMerge, threeWay, type MergeChoice, type MergeField, type MergeItem } from '../../lib/merge3';
import type { PartnerLite } from './PartnerSelect';

export interface ProductLite {
  id: number;
  code: string;
  name: string;
  unit: string;
  is_service: boolean;
  sale_price?: number;
  purchase_price?: number | null;
  /** C11: mã thuế suất mặc định của mặt hàng */
  vat_rate?: string | null;
}

export interface LineDraft {
  key: string;
  /** id dòng trên máy chủ lúc nạp (dòng mới gõ thì không có) */
  id?: number;
  product: ProductLite | null;
  /** Chữ đang gõ ở ô Mã hàng (khi chưa chọn được mã) */
  codeText: string;
  description: string;
  unit: string;
  qty: number | null;
  unit_price: number | null;
  note: string;
  // ---- bản mở rộng M3 (không có ⇒ như bản chuẩn) ----
  /** C10: hệ số quy đổi của `unit` (1 = đơn vị gốc) */
  factor?: number;
  /** C11: thuế suất dòng; undefined = chưa đặt (không gửi), null = không thuế / KCT */
  vat_rate?: number | null;
  /** C9: tồn sổ sách máy chủ trả (đơn vị gốc) */
  book_qty?: number | null;
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
    ...(p.vat_rate !== undefined ? { vat_rate: p.vat_rate } : {}),
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
        id: l.id,
        product: { id: l.product_id, code: l.product_code, name: l.product_name, unit: l.unit, is_service: l.is_service },
        codeText: l.product_code,
        description: l.description,
        unit: l.unit,
        qty: l.qty,
        unit_price: l.unit_price,
        note: l.note,
        ...(l.factor !== undefined ? { factor: l.factor } : {}),
        ...(l.vat_rate !== undefined ? { vat_rate: l.vat_rate } : {}),
        ...(l.book_qty !== undefined ? { book_qty: l.book_qty } : {}),
      })),
    ),
  };
}

export function lineAmount(l: LineDraft): number {
  if (l.qty === null || l.unit_price === null) return 0;
  return Math.round(l.qty * l.unit_price);
}

/** C11: tiền thuế của dòng = round(thành tiền × thuế suất / 100) đến đồng (0 nếu không thuế). */
export function lineTax(l: LineDraft): number {
  if (l.vat_rate === undefined || l.vat_rate === null) return 0;
  const a = lineAmount(l);
  return Math.sign(a) * Math.round((Math.abs(a) * l.vat_rate) / 100);
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
        // id dòng máy chủ: sửa tại chỗ, giữ id (dòng mới không có)
        ...(l.id !== undefined ? { id: l.id } : {}),
        product_id: l.product?.id ?? 0,
        description: l.description.trim(),
        unit: l.unit,
        qty: l.qty,
        unit_price: type === 'transfer' || type === 'stocktake' ? null : l.unit_price,
        note: l.note,
        // C11: chỉ gửi khi dòng có thuế suất (bản chuẩn: không bao giờ có)
        ...(l.vat_rate !== undefined ? { vat_rate: l.vat_rate } : {}),
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

// ---------- Gộp khi hai máy cùng sửa (F-01, F-10) ----------
const show = (v: number | null, money: boolean) => (v === null ? '(trống)' : money ? formatMoney(v) : formatQty(v));
export const DOC_FIELDS: MergeField<LineDraft>[] = [
  {
    label: 'Mặt hàng',
    value: (l) => l.product?.id ?? null,
    copy: (to, from) => ({ ...to, product: from.product, codeText: from.codeText, unit: from.unit, factor: from.factor }),
    show: (l) => l.product?.code ?? '',
  },
  { label: 'Diễn giải', value: (l) => l.description.trim(), copy: (to, from) => ({ ...to, description: from.description }), show: (l) => l.description.trim() || '(trống)' },
  // đơn vị đi cùng hệ số quy đổi (C10)
  { label: 'ĐVT', value: (l) => `${l.unit}|${l.factor ?? 1}`, copy: (to, from) => ({ ...to, unit: from.unit, factor: from.factor }), show: (l) => l.unit || '(trống)' },
  { label: 'SL', value: (l) => l.qty, copy: (to, from) => ({ ...to, qty: from.qty }), show: (l) => show(l.qty, false) },
  { label: 'Đơn giá', value: (l) => l.unit_price, copy: (to, from) => ({ ...to, unit_price: from.unit_price }), show: (l) => show(l.unit_price, true) },
  {
    label: 'Thuế suất',
    value: (l) => (l.vat_rate === undefined ? 'x' : l.vat_rate === null ? 'KCT' : String(l.vat_rate)),
    copy: (to, from) => ({ ...to, vat_rate: from.vat_rate }),
    show: (l) => (l.vat_rate === undefined || l.vat_rate === null ? 'KCT' : `${l.vat_rate}%`),
  },
  { label: 'Ghi chú', value: (l) => l.note.trim(), copy: (to, from) => ({ ...to, note: from.note }), show: (l) => l.note.trim() || '(trống)' },
];

/** So ba bản: lúc nạp (base), máy này (mine), bản máy kia vừa lưu (theirs). */
export function mergeLines(base: LineDraft[], mine: LineDraft[], theirs: LineDraft[]): MergeItem<LineDraft>[] {
  return threeWay({
    base: base.filter((l) => !isBlank(l)),
    mine: sentLines(mine).filter((l) => !!l.product),
    theirs: theirs.filter((l) => !isBlank(l)),
    fields: DOC_FIELDS,
  });
}

export function applyLineMerge(current: LineDraft[], items: MergeItem<LineDraft>[], choices: Record<string, MergeChoice>): LineDraft[] {
  return withTrailingBlank(applyMerge(current.filter((l) => !isBlank(l)), items, choices, DOC_FIELDS, newKey));
}
