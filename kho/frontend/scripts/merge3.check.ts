// Kiểm tra gộp ba chiều (F-10): npm run test:merge
import { applyMerge, threeWay, type MergeChoice, type MergeField } from '../src/lib/merge3';

interface L {
  key: string;
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
const run = (base: L[], mine: L[], theirs: L[], choices: Record<string, MergeChoice> = {}) => {
  const items = threeWay({ base, mine, theirs, fields: F, compatible: (a, b) => a.p === b.p });
  const out = applyMerge(theirs, items, choices, F, k).map((l) => `${l.p}:${l.qty}@${l.price}`);
  return { items, out };
};
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ĐẠT ' : 'SAI '} ${name}${ok ? '' : `\n   được: ${JSON.stringify(got)}\n   cần:  ${JSON.stringify(want)}`}`);
};
const l = (key: string, p: string, qty: number, price: number): L => ({ key, p, qty, price });

// 1. cùng dòng: máy kia sửa giá, tôi sửa SL
{
  const base = [l('a', 'MATNA', 3, 350), l('b', 'GANGTAY', 12, 45)];
  const r = run(base, [base[0]!, l('b', 'GANGTAY', 15, 45)], [l('x', 'MATNA', 3, 350), l('y', 'GANGTAY', 12, 44)]);
  eq('SL của tôi + giá của máy kia', r.out, ['MATNA:3@350', 'GANGTAY:15@44']);
  eq('chỉ một mục "Đã sửa"', r.items.map((i) => i.kind), ['edited']);
}
// 2. cùng ô, hai giá trị khác nhau ⇒ hỏi; mặc định của máy kia
{
  const base = [l('a', 'BUAGO', 5, 35), l('b', 'BUAGO', 2, 30), l('c', 'MATNA', 1, 350)];
  const mine = [base[0]!, l('b', 'BUAGO', 4, 30), base[2]!];
  const theirs = [l('x', 'BUAGO', 5, 35), l('y', 'BUAGO', 3, 30), l('z', 'MATNA', 1, 350)];
  const r = run(base, mine, theirs);
  eq('cùng mặt hàng hai dòng — đúng dòng 2, mặc định máy kia', r.out, ['BUAGO:5@35', 'BUAGO:3@30', 'MATNA:1@350']);
  eq('mục cần chọn', r.items.map((i) => [i.kind, i.conflicts]), [['conflict', [{ label: 'SL', theirs: '3', mine: '4' }]]]);
  eq('chọn "Dùng của tôi"', run(base, mine, theirs, { b: 'mine' }).out, ['BUAGO:5@35', 'BUAGO:4@30', 'MATNA:1@350']);
}
// 3. tôi sửa / máy kia xóa
{
  const base = [l('a', 'A', 1, 10), l('b', 'B', 2, 20)];
  const mine = [base[0]!, l('b', 'B', 5, 20)];
  const theirs = [l('x', 'A', 1, 10)];
  eq('máy kia xóa, tôi sửa — mặc định giữ bản đã lưu', run(base, mine, theirs).out, ['A:1@10']);
  eq('… chọn của tôi ⇒ thêm lại dòng tôi sửa', run(base, mine, theirs, { b: 'mine' }).out, ['A:1@10', 'B:5@20']);
}
// 4. tôi xóa / máy kia sửa
{
  const base = [l('a', 'A', 1, 10), l('b', 'B', 2, 20)];
  const theirs = [l('x', 'A', 1, 10), l('y', 'B', 7, 20)];
  eq('tôi xóa, máy kia sửa — mặc định giữ', run(base, [base[0]!], theirs).out, ['A:1@10', 'B:7@20']);
  eq('… chọn của tôi ⇒ xóa', run(base, [base[0]!], theirs, { b: 'mine' }).out, ['A:1@10']);
  eq('tôi xóa, máy kia không đổi ⇒ xóa', run(base, [base[0]!], [l('x', 'A', 1, 10), l('y', 'B', 2, 20)]).out, ['A:1@10']);
}
// 5. máy kia xóa dòng giữa + thêm dòng cuối; tôi sửa dòng 3 và thêm dòng
{
  const base = [l('a', 'A', 1, 10), l('b', 'B', 2, 20), l('c', 'C', 3, 30)];
  const mine = [base[0]!, base[1]!, l('c', 'C', 9, 30), l('d', 'D', 1, 1)];
  const theirs = [l('x', 'A', 1, 10), l('z', 'C', 3, 30), l('w', 'E', 1, 5)];
  eq('xóa giữa + thêm', run(base, mine, theirs).out, ['A:1@10', 'C:9@30', 'E:1@5', 'D:1@1']);
}
// 6. hai máy sửa cùng ô thành cùng giá trị ⇒ không hỏi
{
  const base = [l('a', 'A', 1, 10)];
  const r = run(base, [l('a', 'A', 2, 10)], [l('x', 'A', 2, 10)]);
  eq('sửa giống nhau', [r.out, r.items.map((i) => i.kind)], [['A:2@10'], ['edited']]);
}
if (fail) {
  console.error(`${fail} trường hợp sai`);
  process.exit(1);
}
console.log('Gộp ba chiều: tất cả đạt');
