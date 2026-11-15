// Kiểm tra gộp ba chiều theo id dòng (F-10): npm run test:merge
import { applyMerge, threeWay, type MergeChoice, type MergeField } from '../src/lib/merge3';

interface L {
  key: string;
  id?: number;
  p: string;
  qty: number;
  price: number;
}
const F: MergeField<L>[] = [
  { label: 'Mặt hàng', value: (l) => l.p, copy: (t, f) => ({ ...t, p: f.p }), show: (l) => l.p },
  { label: 'SL', value: (l) => l.qty, copy: (t, f) => ({ ...t, qty: f.qty }), show: (l) => String(l.qty) },
  { label: 'Đơn giá', value: (l) => l.price, copy: (t, f) => ({ ...t, price: f.price }), show: (l) => String(l.price) },
];
let n = 0;
const k = () => `n${n++}`;
/** Dòng có id máy chủ (key giả lập key trên máy: mỗi máy một key riêng) */
const s = (id: number, p: string, qty: number, price: number, who = 'b'): L => ({ key: `${who}${id}`, id, p, qty, price });
/** Dòng mới gõ, chưa có id */
const nw = (key: string, p: string, qty: number, price: number): L => ({ key, p, qty, price });
const show = (ls: L[]) => ls.map((l) => `${l.id ?? 'mới'}|${l.p}:${l.qty}@${l.price}`);
const run = (base: L[], mine: L[], theirs: L[], choices: Record<string, MergeChoice> = {}) => {
  const items = threeWay({ base, mine, theirs, fields: F });
  const out = applyMerge(theirs, items, choices, F, k);
  return { items, out: show(out) };
};
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ĐẠT ' : 'SAI '} ${name}${ok ? '' : `\n   được: ${JSON.stringify(got)}\n   cần:  ${JSON.stringify(want)}`}`);
};
// máy này giữ key của bản nạp; bản máy kia có key riêng (t…)
const T = (l: L): L => ({ ...l, key: `t${l.id ?? l.key}` });

// 1. cùng dòng: máy kia sửa giá, tôi sửa SL
{
  const base = [s(1, 'MATNA', 3, 350), s(2, 'GANGTAY', 12, 45)];
  const r = run(base, [base[0]!, { ...base[1]!, qty: 15 }], [T(s(1, 'MATNA', 3, 350)), T(s(2, 'GANGTAY', 12, 44))]);
  eq('SL của tôi + giá của máy kia', r.out, ['1|MATNA:3@350', '2|GANGTAY:15@44']);
  eq('chỉ một mục "Đã sửa"', r.items.map((i) => i.kind), ['edited']);
}
// 2. cùng ô, hai giá trị khác nhau ⇒ hỏi; mặc định của máy kia
{
  const base = [s(1, 'BUAGO', 5, 35), s(2, 'BUAGO', 2, 30), s(3, 'MATNA', 1, 350)];
  const mine = [base[0]!, { ...base[1]!, qty: 4 }, base[2]!];
  const theirs = [T(s(1, 'BUAGO', 5, 35)), T(s(2, 'BUAGO', 3, 30)), T(s(3, 'MATNA', 1, 350))];
  const r = run(base, mine, theirs);
  eq('cùng mặt hàng hai dòng — đúng dòng 2, mặc định máy kia', r.out, ['1|BUAGO:5@35', '2|BUAGO:3@30', '3|MATNA:1@350']);
  eq('mục cần chọn', r.items.map((i) => [i.kind, i.conflicts]), [['conflict', [{ label: 'SL', theirs: '3', mine: '4' }]]]);
  eq('chọn "Dùng của tôi"', run(base, mine, theirs, { b2: 'mine' }).out, ['1|BUAGO:5@35', '2|BUAGO:4@30', '3|MATNA:1@350']);
}
// 3. tôi sửa / máy kia xóa
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20)];
  const mine = [base[0]!, { ...base[1]!, qty: 5 }];
  const theirs = [T(s(1, 'A', 1, 10))];
  eq('máy kia xóa, tôi sửa — mặc định giữ bản đã lưu', run(base, mine, theirs).out, ['1|A:1@10']);
  eq('… chọn của tôi ⇒ thêm lại thành dòng mới (không mang id cũ)', run(base, mine, theirs, { b2: 'mine' }).out, ['1|A:1@10', 'mới|B:5@20']);
}
// 3b. dòng giữa bị máy kia xóa, tôi giữ lại ⇒ về đúng chỗ cũ (giữa A và C)
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20), s(3, 'C', 3, 30)];
  const mine = [base[0]!, { ...base[1]!, qty: 5 }, base[2]!];
  const theirs = [T(s(1, 'A', 1, 10)), T(s(3, 'C', 3, 30))];
  eq('giữ dòng giữa máy kia đã xóa ⇒ đứng chỗ cũ', run(base, mine, theirs, { b2: 'mine' }).out, ['1|A:1@10', 'mới|B:5@20', '3|C:3@30']);
  const theirs2 = [T(s(3, 'C', 3, 30))];
  const mine2 = [{ ...base[0]!, qty: 7 }, base[1]!, base[2]!];
  eq('… dòng đầu: đứng trước dòng sau nó', run(base, mine2, theirs2, { b1: 'mine' }).out, ['mới|A:7@10', '3|C:3@30']);
}
// 4. tôi xóa / máy kia sửa
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20)];
  const theirs = [T(s(1, 'A', 1, 10)), T(s(2, 'B', 7, 20))];
  eq('tôi xóa, máy kia sửa — mặc định giữ', run(base, [base[0]!], theirs).out, ['1|A:1@10', '2|B:7@20']);
  eq('… chọn của tôi ⇒ xóa', run(base, [base[0]!], theirs, { b2: 'mine' }).out, ['1|A:1@10']);
  eq('tôi xóa, máy kia không đổi ⇒ xóa', run(base, [base[0]!], [T(s(1, 'A', 1, 10)), T(s(2, 'B', 2, 20))]).out, ['1|A:1@10']);
}
// 5. máy kia xóa dòng giữa + thêm dòng cuối; tôi sửa dòng 3 và thêm dòng
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20), s(3, 'C', 3, 30)];
  const mine = [base[0]!, base[1]!, { ...base[2]!, qty: 9 }, nw('m1', 'D', 1, 1)];
  const theirs = [T(s(1, 'A', 1, 10)), T(s(3, 'C', 3, 30)), T(s(7, 'E', 1, 5))];
  eq('xóa giữa + thêm', run(base, mine, theirs).out, ['1|A:1@10', '3|C:9@30', '7|E:1@5', 'mới|D:1@1']);
}
// 6. hai máy sửa cùng ô thành cùng giá trị ⇒ không hỏi
{
  const base = [s(1, 'A', 1, 10)];
  const r = run(base, [{ ...base[0]!, qty: 2 }], [T(s(1, 'A', 2, 10))]);
  eq('sửa giống nhau', [r.out, r.items.map((i) => i.kind)], [['1|A:2@10'], ['edited']]);
}
// 7. tôi đổi thứ tự, máy kia sửa một dòng ⇒ thứ tự của tôi + số của máy kia
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20), s(3, 'C', 3, 30)];
  const mine = [base[2]!, base[0]!, base[1]!];
  const theirs = [T(s(1, 'A', 1, 10)), T(s(2, 'B', 8, 20)), T(s(3, 'C', 3, 30))];
  const r = run(base, mine, theirs);
  eq('tôi dời dòng, máy kia sửa', r.out, ['3|C:3@30', '1|A:1@10', '2|B:8@20']);
  eq('… một mục "Đổi thứ tự"', r.items.map((i) => i.kind), ['reordered']);
}
// 8. máy kia đổi thứ tự, tôi sửa một dòng ⇒ thứ tự của máy kia + số của tôi, sửa đúng dòng
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20), s(3, 'C', 3, 30)];
  const mine = [base[0]!, { ...base[1]!, qty: 6 }, base[2]!];
  const theirs = [T(s(3, 'C', 3, 30)), T(s(2, 'B', 2, 20)), T(s(1, 'A', 1, 10))];
  eq('máy kia dời dòng, tôi sửa', run(base, mine, theirs).out, ['3|C:3@30', '2|B:6@20', '1|A:1@10']);
}
// 9. cùng mặt hàng trên ba dòng: sửa dòng 3, máy kia sửa dòng 1 ⇒ không lẫn
{
  const base = [s(1, 'X', 1, 10), s(2, 'X', 1, 10), s(3, 'X', 1, 10)];
  const mine = [base[0]!, base[1]!, { ...base[2]!, qty: 3 }];
  const theirs = [T(s(1, 'X', 5, 10)), T(s(2, 'X', 1, 10)), T(s(3, 'X', 1, 10))];
  const r = run(base, mine, theirs);
  eq('ba dòng giống hệt: mỗi dòng đúng chỗ', r.out, ['1|X:5@10', '2|X:1@10', '3|X:3@10']);
  eq('… chỉ một mục, không hỏi', r.items.map((i) => i.kind), ['edited']);
}
// 10. máy kia xóa dòng A rồi thêm một dòng mới y hệt A; tôi sửa A ⇒ dòng mới không bị coi là A
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20)];
  const mine = [{ ...base[0]!, qty: 4 }, base[1]!];
  const theirs = [T(s(2, 'B', 2, 20)), T(s(9, 'A', 1, 10))];
  const r = run(base, mine, theirs);
  eq('xóa A + thêm A mới: hỏi "máy kia đã xóa"', r.items.map((i) => i.kind), ['theyRemoved']);
  eq('… mặc định: dòng A mới của máy kia giữ nguyên, không bị sửa', r.out, ['2|B:2@20', '9|A:1@10']);
}
// 11. tôi thêm dòng trong khi máy kia đổi thứ tự ⇒ thứ tự máy kia, dòng của tôi ở cuối, không lặp
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20)];
  const mine = [base[0]!, base[1]!, nw('m2', 'C', 1, 30)];
  const theirs = [T(s(2, 'B', 2, 20)), T(s(1, 'A', 1, 10))];
  const r = run(base, mine, theirs);
  eq('tôi thêm, máy kia dời', r.out, ['2|B:2@20', '1|A:1@10', 'mới|C:1@30']);
  eq('… chỉ "Thêm mới"', r.items.map((i) => i.kind), ['added']);
}
// 12. hai máy cùng đổi thứ tự khác nhau ⇒ hỏi, mặc định theo máy kia
{
  const base = [s(1, 'A', 1, 10), s(2, 'B', 2, 20), s(3, 'C', 3, 30)];
  const mine = [base[1]!, base[0]!, base[2]!];
  const theirs = [T(s(1, 'A', 1, 10)), T(s(3, 'C', 3, 30)), T(s(2, 'B', 2, 20))];
  const r = run(base, mine, theirs);
  eq('cùng dời khác nhau: mặc định theo máy kia', [r.items.map((i) => i.kind), r.out], [['bothReordered'], ['1|A:1@10', '3|C:3@30', '2|B:2@20']]);
  eq('… chọn của tôi', run(base, mine, theirs, { [r.items[0]!.id]: 'mine' }).out, ['2|B:2@20', '1|A:1@10', '3|C:3@30']);
}
// 13. dòng không có id luôn là dòng mới (kể cả khi giống hệt dòng đang có)
{
  const base = [s(1, 'A', 1, 10)];
  const r = run(base, [base[0]!, nw('m3', 'A', 1, 10)], [T(s(1, 'A', 1, 10))]);
  eq('dòng không id giống hệt ⇒ vẫn thêm', r.out, ['1|A:1@10', 'mới|A:1@10']);
}
if (fail) {
  console.error(`${fail} trường hợp sai`);
  process.exit(1);
}
console.log('Gộp ba chiều theo id dòng: tất cả đạt');
