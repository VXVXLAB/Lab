// Gộp ba chiều các dòng phiếu khi hai máy cùng sửa (F-10).
//
// - base: các dòng lúc máy này nạp phiếu; mine: các dòng máy này đang có; theirs: bản máy kia vừa lưu.
// - Một dòng được nhận ra CHỈ bằng id dòng trên máy chủ (máy chủ giữ id khi sửa phiếu). Dòng không có id (hoặc id không
//   có trong bản lúc nạp) là dòng mới. Không bao giờ ghép theo mã hàng hay theo vị trí.
// - Từng ô: chỉ tôi sửa ⇒ của tôi; chỉ máy kia sửa ⇒ của máy kia; cả hai sửa thành giá trị khác nhau ⇒ hỏi (mặc định giữ của máy kia).
// - Tôi sửa / máy kia xóa, hoặc tôi xóa / máy kia sửa ⇒ hỏi (mặc định giữ như bản đã lưu).
// - Thứ tự dòng: chỉ tôi đổi ⇒ theo tôi; chỉ máy kia đổi ⇒ theo máy kia; cả hai đổi khác nhau ⇒ hỏi (mặc định theo máy kia).

export interface MergeField<L> {
  label: string;
  /** Giá trị dùng để so sánh */
  value: (l: L) => string | number | null;
  /** Chép ô này từ `from` sang `to` */
  copy: (to: L, from: L) => L;
  /** Hiển thị giá trị cho người dùng */
  show: (l: L) => string;
}

export type MergeKind = 'added' | 'edited' | 'removed' | 'conflict' | 'theyRemoved' | 'theyEdited' | 'reordered' | 'bothReordered';
export type MergeChoice = 'theirs' | 'mine';

export interface FieldConflict {
  label: string;
  theirs: string;
  mine: string;
}

export interface MergeItem<L> {
  id: string;
  kind: MergeKind;
  /** Dòng của máy này (thêm / sửa); với dòng tôi xóa là dòng gốc */
  line: L;
  base: L | null;
  /** key của dòng tương ứng trong bản mới (null nếu máy kia đã xóa / dòng mới) */
  theirsKey: string | null;
  /** Ô chỉ máy này sửa — luôn đưa vào */
  mineFields: string[];
  /** Ô hai máy cùng sửa khác nhau — theo lựa chọn */
  conflicts: FieldConflict[];
  /** Đổi thứ tự: id các dòng chung theo thứ tự của máy này */
  order?: number[];
  /** Dòng máy kia đã xóa mà tôi giữ lại: đặt lại ở chỗ cũ — sau dòng `after` / trước dòng `before` (id, theo bản lúc nạp) */
  anchor?: { after?: number; before?: number };
}

export interface Identified {
  key: string;
  /** id dòng trên máy chủ; không có = dòng mới gõ */
  id?: number;
}

const sameSeq = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function threeWay<L extends Identified>(opts: { base: L[]; mine: L[]; theirs: L[]; fields: MergeField<L>[] }): MergeItem<L>[] {
  const { base, mine, theirs, fields } = opts;
  const eq = (f: MergeField<L>, a: L, b: L) => f.value(a) === f.value(b);
  const same = (a: L, b: L) => fields.every((f) => eq(f, a, b));
  const byId = (ls: L[]) => {
    const m = new Map<number, L>();
    for (const l of ls) if (l.id !== undefined && !m.has(l.id)) m.set(l.id, l);
    return m;
  };
  const baseById = byId(base);
  const theirsById = byId(theirs);
  const items: MergeItem<L>[] = [];
  const seen = new Set<number>();
  for (const l of mine) {
    const b = l.id !== undefined && !seen.has(l.id) ? baseById.get(l.id) : undefined;
    if (!b || l.id === undefined) {
      // không có id (hoặc id không có trong bản lúc nạp) ⇒ dòng mới
      items.push({ id: l.key, kind: 'added', line: l, base: null, theirsKey: null, mineFields: [], conflicts: [] });
      continue;
    }
    seen.add(l.id);
    if (same(b, l)) continue; // tôi không đổi dòng này ⇒ bản mới thế nào giữ thế ấy
    const t = theirsById.get(l.id);
    if (!t) {
      const bi = base.indexOf(b);
      const after = base.slice(0, bi).reverse().find((x) => x.id !== undefined && theirsById.has(x.id))?.id;
      const before = base.slice(bi + 1).find((x) => x.id !== undefined && theirsById.has(x.id))?.id;
      items.push({ id: l.key, kind: 'theyRemoved', line: l, base: b, theirsKey: null, mineFields: [], conflicts: [], anchor: { after, before } });
      continue;
    }
    const mineFields: string[] = [];
    const conflicts: FieldConflict[] = [];
    for (const f of fields) {
      if (eq(f, b, l)) continue; // tôi không sửa ô này
      if (eq(f, b, t) || eq(f, t, l)) mineFields.push(f.label); // máy kia không sửa, hoặc sửa giống tôi
      else conflicts.push({ label: f.label, theirs: f.show(t), mine: f.show(l) });
    }
    items.push({ id: l.key, kind: conflicts.length ? 'conflict' : 'edited', line: l, base: b, theirsKey: t.key, mineFields, conflicts });
  }
  for (const b of base) {
    if (b.id === undefined || seen.has(b.id)) continue;
    const t = theirsById.get(b.id);
    if (t && !same(b, t)) items.push({ id: b.key, kind: 'theyEdited', line: b, base: b, theirsKey: t.key, mineFields: [], conflicts: [] });
    else items.push({ id: b.key, kind: 'removed', line: b, base: b, theirsKey: t ? t.key : null, mineFields: [], conflicts: [] });
  }
  // Thứ tự: chỉ xét các dòng có ở cả ba bản
  const common = (ls: L[]) => {
    const out: number[] = [];
    for (const l of ls) if (l.id !== undefined && seen.has(l.id) && theirsById.has(l.id) && !out.includes(l.id)) out.push(l.id);
    return out;
  };
  const bo = common(base);
  const mo = common(mine);
  const to = common(theirs);
  if (!sameSeq(mo, bo) && !sameSeq(mo, to)) {
    const i = mo.findIndex((x, k) => x !== bo[k]);
    const moved = mine.find((l) => l.id === mo[i])!;
    const kind: MergeKind = sameSeq(to, bo) ? 'reordered' : 'bothReordered';
    items.push({ id: `order:${moved.key}`, kind, line: moved, base: null, theirsKey: null, mineFields: [], conflicts: [], order: mo });
  }
  return items;
}

/** Đưa các thay đổi đã chọn vào các dòng hiện có (bản mới). Không bao giờ thêm dòng cho một lần sửa. */
export function applyMerge<L extends Identified>(
  current: L[],
  items: MergeItem<L>[],
  choices: Record<string, MergeChoice>,
  fields: MergeField<L>[],
  newKey: () => string,
): L[] {
  let out = [...current];
  const byLabel = new Map(fields.map((f) => [f.label, f]));
  for (const it of items) {
    const choice = choices[it.id] ?? 'theirs';
    const j = it.theirsKey ? out.findIndex((l) => l.key === it.theirsKey) : -1;
    if (it.kind === 'reordered' || it.kind === 'bothReordered') continue; // làm sau cùng
    // dòng mới / dòng máy kia đã xóa mà tôi giữ lại ⇒ dòng mới trên máy chủ (không mang id)
    if (it.kind === 'added') out.push({ ...it.line, key: newKey(), id: undefined });
    else if (it.kind === 'edited' || it.kind === 'conflict') {
      if (j < 0) continue;
      const labels = choice === 'mine' ? [...it.mineFields, ...it.conflicts.map((c) => c.label)] : it.mineFields;
      let row = out[j]!;
      for (const lb of labels) {
        const f = byLabel.get(lb);
        if (f) row = f.copy(row, it.line);
      }
      out[j] = row;
    } else if (it.kind === 'removed' || (it.kind === 'theyEdited' && choice === 'mine')) {
      if (j >= 0) out = out.filter((_, i) => i !== j);
    } else if (it.kind === 'theyRemoved' && choice === 'mine') {
      // giữ dòng ở chỗ cũ: sau dòng đứng trước nó lúc nạp (hoặc trước dòng đứng sau nó), không thì cuối phiếu
      const row = { ...it.line, key: newKey(), id: undefined };
      const ai = it.anchor?.after !== undefined ? out.findIndex((x) => x.id === it.anchor!.after) : -1;
      const bi = ai < 0 && it.anchor?.before !== undefined ? out.findIndex((x) => x.id === it.anchor!.before) : -1;
      if (ai >= 0) out.splice(ai + 1, 0, row);
      else if (bi >= 0) out.splice(bi, 0, row);
      else out.push(row);
    }
  }
  const ord = items.find((it) => it.kind === 'reordered' || (it.kind === 'bothReordered' && (choices[it.id] ?? 'theirs') === 'mine'));
  if (ord?.order) {
    // xếp lại các dòng chung theo thứ tự của tôi, giữ nguyên chỗ của các dòng khác (dòng mới của hai bên)
    const want = ord.order.filter((id) => out.some((l) => l.id === id));
    const slots = out.map((l, i) => (l.id !== undefined && want.includes(l.id) ? i : -1)).filter((i) => i >= 0);
    const byId = new Map(out.map((l) => [l.id, l]));
    const next = [...out];
    slots.forEach((slot, k) => {
      next[slot] = byId.get(want[k])!;
    });
    out = next;
  }
  return out;
}

export const MERGE_LABEL: Record<MergeKind, string> = {
  added: 'Thêm mới',
  edited: 'Đã sửa',
  removed: 'Đã xóa',
  conflict: 'Cùng sửa',
  theyRemoved: 'Máy kia đã xóa',
  theyEdited: 'Máy kia đã sửa',
  reordered: 'Đổi thứ tự',
  bothReordered: 'Cùng đổi thứ tự',
};
export const MERGE_COLOR: Record<MergeKind, string> = {
  added: 'blue',
  edited: 'orange',
  removed: 'red',
  conflict: 'magenta',
  theyRemoved: 'magenta',
  theyEdited: 'magenta',
  reordered: 'orange',
  bothReordered: 'magenta',
};

/** Câu giải thích cho dòng cần chọn */
export function conflictText<L>(it: MergeItem<L>): string {
  if (it.kind === 'conflict') return it.conflicts.map((c) => `Cùng sửa: ${c.label} — máy kia: ${c.theirs}, bạn: ${c.mine}`).join('; ');
  if (it.kind === 'theyRemoved') return 'Máy kia đã xóa dòng này, bạn đã sửa';
  if (it.kind === 'theyEdited') return 'Máy kia đã sửa dòng này, bạn đã xóa';
  if (it.kind === 'bothReordered') return 'Hai máy cùng đổi thứ tự dòng, mỗi máy một kiểu';
  return '';
}
export const needsChoice = (k: MergeKind) => k === 'conflict' || k === 'theyRemoved' || k === 'theyEdited' || k === 'bothReordered';
export const isOrderItem = (k: MergeKind) => k === 'reordered' || k === 'bothReordered';
