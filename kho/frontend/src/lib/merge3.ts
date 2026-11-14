// Gộp ba chiều các dòng phiếu khi hai máy cùng sửa (F-10).
//
// - base: các dòng lúc máy này nạp phiếu; mine: các dòng máy này đang có; theirs: bản máy kia vừa lưu.
// - Dòng của máy này nhận ra dòng gốc qua `key` (gắn với dòng máy chủ lúc nạp, tức là id dòng); dòng mới gõ thì không có dòng gốc.
// - Máy chủ cấp lại id dòng mỗi lần lưu (xóa rồi ghi lại các dòng), nên dòng gốc ↔ dòng của bản mới được ghép theo thứ tự
//   (máy kia lưu các dòng theo đúng thứ tự trên lưới của họ) và mức giống nhau, KHÔNG theo mã hàng: hai dòng cùng mặt hàng
//   vẫn là hai dòng riêng.
// - Từng ô: chỉ tôi sửa ⇒ của tôi; chỉ máy kia sửa ⇒ của máy kia; cả hai sửa thành giá trị khác nhau ⇒ hỏi (mặc định giữ của máy kia).
// - Tôi sửa / máy kia xóa, hoặc tôi xóa / máy kia sửa ⇒ hỏi (mặc định giữ như bản đã lưu).

export interface MergeField<L> {
  label: string;
  /** Giá trị dùng để so sánh */
  value: (l: L) => string | number | null;
  /** Chép ô này từ `from` sang `to` */
  copy: (to: L, from: L) => L;
  /** Hiển thị giá trị cho người dùng */
  show: (l: L) => string;
}

export type MergeKind = 'added' | 'edited' | 'removed' | 'conflict' | 'theyRemoved' | 'theyEdited';
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
}

/** Ghép dòng gốc với dòng bản mới, giữ thứ tự (quy hoạch động, điểm = số ô giống nhau). */
export function alignLines<L>(base: L[], theirs: L[], fields: MergeField<L>[], compatible: (a: L, b: L) => boolean): (number | null)[] {
  const n = base.length;
  const m = theirs.length;
  const score = (i: number, j: number) => {
    const a = base[i]!;
    const b = theirs[j]!;
    if (!compatible(a, b)) return -1;
    let s = 1;
    for (const f of fields) if (f.value(a) === f.value(b)) s += 2;
    // cùng vị trí: ưu tiên nhẹ khi có nhiều cách ghép bằng điểm
    if (i === j) s += 1;
    return s;
  };
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      const sc = score(i, j);
      dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!, sc > 0 ? sc + dp[i + 1]![j + 1]! : -Infinity);
    }
  const out: (number | null)[] = new Array<number | null>(n).fill(null);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const sc = score(i, j);
    if (sc > 0 && dp[i]![j] === sc + dp[i + 1]![j + 1]!) {
      out[i] = j;
      i++;
      j++;
    } else if (dp[i]![j] === dp[i + 1]![j]) i++;
    else j++;
  }
  return out;
}

export function threeWay<L extends { key: string }>(opts: {
  base: L[];
  mine: L[];
  theirs: L[];
  fields: MergeField<L>[];
  compatible: (a: L, b: L) => boolean;
}): MergeItem<L>[] {
  const { base, mine, theirs, fields } = opts;
  const eq = (f: MergeField<L>, a: L, b: L) => f.value(a) === f.value(b);
  const same = (a: L, b: L) => fields.every((f) => eq(f, a, b));
  const align = alignLines(base, theirs, fields, opts.compatible);
  const baseIdx = new Map(base.map((b, i) => [b.key, i]));
  const items: MergeItem<L>[] = [];
  const seen = new Set<string>();
  for (const l of mine) {
    const bi = baseIdx.get(l.key);
    if (bi === undefined) {
      items.push({ id: l.key, kind: 'added', line: l, base: null, theirsKey: null, mineFields: [], conflicts: [] });
      continue;
    }
    seen.add(l.key);
    const b = base[bi]!;
    if (same(b, l)) continue; // tôi không đổi dòng này ⇒ bản mới thế nào giữ thế ấy
    const ti = align[bi];
    const t = ti === null || ti === undefined ? null : theirs[ti]!;
    if (!t) {
      items.push({ id: l.key, kind: 'theyRemoved', line: l, base: b, theirsKey: null, mineFields: [], conflicts: [] });
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
  base.forEach((b, bi) => {
    if (seen.has(b.key)) return;
    const ti = align[bi];
    const t = ti === null || ti === undefined ? null : theirs[ti]!;
    if (t && !same(b, t)) items.push({ id: b.key, kind: 'theyEdited', line: b, base: b, theirsKey: t.key, mineFields: [], conflicts: [] });
    else items.push({ id: b.key, kind: 'removed', line: b, base: b, theirsKey: t ? t.key : null, mineFields: [], conflicts: [] });
  });
  return items;
}

/** Đưa các thay đổi đã chọn vào các dòng hiện có (bản mới). Không bao giờ thêm dòng cho một lần sửa. */
export function applyMerge<L extends { key: string }>(
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
    if (it.kind === 'added') out.push({ ...it.line, key: newKey() });
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
    } else if (it.kind === 'theyRemoved' && choice === 'mine') out.push({ ...it.line, key: newKey() });
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
};
export const MERGE_COLOR: Record<MergeKind, string> = {
  added: 'blue',
  edited: 'orange',
  removed: 'red',
  conflict: 'magenta',
  theyRemoved: 'magenta',
  theyEdited: 'magenta',
};

/** Câu giải thích cho dòng cần chọn */
export function conflictText<L>(it: MergeItem<L>): string {
  if (it.kind === 'conflict') return it.conflicts.map((c) => `Cùng sửa: ${c.label} — máy kia: ${c.theirs}, bạn: ${c.mine}`).join('; ');
  if (it.kind === 'theyRemoved') return 'Máy kia đã xóa dòng này, bạn đã sửa';
  if (it.kind === 'theyEdited') return 'Máy kia đã sửa dòng này, bạn đã xóa';
  return '';
}
export const needsChoice = (k: MergeKind) => k === 'conflict' || k === 'theyRemoved' || k === 'theyEdited';
