// Đọc số thành chữ tiếng Việt cho dòng "Bằng chữ" trên phiếu thu/chi.
// Quy tắc: linh (105 = một trăm linh năm), mười/mươi, mốt (21), lăm (15, 25), bốn (24 = hai mươi bốn — theo quyết định của khách), "không trăm" ở nhóm giữa
// (1.005 = một nghìn không trăm linh năm), nhóm 000 bỏ qua, tỷ đọc lặp (1.000.000.000.000 = một nghìn tỷ).

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc một nhóm 3 chữ số. `full` = không phải nhóm đứng đầu ⇒ đọc đủ "không trăm", "linh". */
function readGroup(n: number, full: boolean): string[] {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const w: string[] = [];
  if (h > 0 || full) w.push(DIGITS[h]!, 'trăm');
  if (t === 0) {
    if (u > 0 && (h > 0 || full)) w.push('linh');
  } else if (t === 1) {
    w.push('mười');
  } else {
    w.push(DIGITS[t]!, 'mươi');
  }
  if (u > 0) {
    if (u === 1 && t > 1) w.push('mốt');
    else if (u === 5 && t > 0) w.push('lăm');
    else w.push(DIGITS[u]!);
  }
  return w;
}

/** Số nguyên < 1 tỷ. */
function readBelowBillion(n: number, leading: boolean): string[] {
  const units = ['', 'nghìn', 'triệu'];
  const groups = [n % 1000, Math.floor(n / 1000) % 1000, Math.floor(n / 1_000_000)];
  let top = 2;
  while (top > 0 && groups[top] === 0) top--;
  const w: string[] = [];
  for (let i = top; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    w.push(...readGroup(g, !(leading && i === top)));
    if (units[i]) w.push(units[i]!);
  }
  return w;
}

function readInt(n: number, leading: boolean): string[] {
  if (n >= 1_000_000_000) {
    const high = Math.floor(n / 1_000_000_000);
    const low = n % 1_000_000_000;
    const w = [...readInt(high, leading), 'tỷ'];
    if (low > 0) w.push(...readBelowBillion(low, false));
    return w;
  }
  return readBelowBillion(n, leading);
}

/** 2590000 ⇒ "hai triệu năm trăm chín mươi nghìn". */
export function numberToVietnameseWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  const n = Math.round(Math.abs(value));
  if (n === 0) return 'không';
  const words = readInt(n, true).join(' ');
  return value < 0 ? `âm ${words}` : words;
}

/** "Hai triệu năm trăm chín mươi nghìn đồng" — dùng cho dòng Bằng chữ. */
export function moneyInWords(value: number): string {
  const w = numberToVietnameseWords(value);
  return w ? `${w.charAt(0).toUpperCase()}${w.slice(1)} đồng` : '';
}
