// Kiểm tra đọc số thành chữ. Chạy: npm run test:words
import { moneyInWords, numberToVietnameseWords } from '../src/lib/numberWords';

const cases: [number, string][] = [
  [0, 'không'],
  [5, 'năm'],
  [10, 'mười'],
  [15, 'mười lăm'],
  [21, 'hai mươi mốt'],
  [24, 'hai mươi bốn'],
  [25, 'hai mươi lăm'],
  [34, 'ba mươi bốn'],
  [55, 'năm mươi lăm'],
  [101, 'một trăm linh một'],
  [104, 'một trăm linh bốn'],
  [105, 'một trăm linh năm'],
  [110, 'một trăm mười'],
  [114, 'một trăm mười bốn'],
  [115, 'một trăm mười lăm'],
  [1000, 'một nghìn'],
  [1005, 'một nghìn không trăm linh năm'],
  [1015, 'một nghìn không trăm mười lăm'],
  [10005, 'mười nghìn không trăm linh năm'],
  [1000000, 'một triệu'],
  [1000005, 'một triệu không trăm linh năm'],
  [2590000, 'hai triệu năm trăm chín mươi nghìn'],
  [5990000, 'năm triệu chín trăm chín mươi nghìn'],
  [1234567891, 'một tỷ hai trăm ba mươi bốn triệu năm trăm sáu mươi bảy nghìn tám trăm chín mươi mốt'],
  [1000000000, 'một tỷ'],
  [1000000000000, 'một nghìn tỷ'],
  [2000050000, 'hai tỷ không trăm năm mươi nghìn'],
  [-400000, 'âm bốn trăm nghìn'],
];
let bad = 0;
for (const [n, want] of cases) {
  const got = numberToVietnameseWords(n);
  if (got !== want) {
    bad++;
    console.log(`SAI  ${n}: "${got}" (đúng: "${want}")`);
  }
}
if (moneyInWords(8455000) !== 'Tám triệu bốn trăm năm mươi lăm nghìn đồng') {
  bad++;
  console.log('SAI  moneyInWords(8455000)');
}
console.log(bad ? `${bad} trường hợp SAI` : `Đúng cả ${cases.length + 1} trường hợp`);
if (bad) throw new Error('numberWords sai');
