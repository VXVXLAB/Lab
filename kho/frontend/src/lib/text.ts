// So khớp chữ kiểu người Việt gõ: không dấu, không phân biệt hoa thường, bỏ dấu câu, nhiều từ theo thứ tự bất kỳ.
// "viet han" khớp "Thiết bị hàn Việt – Hàn"; "que 3.2" khớp "Que hàn Kiswel K7018-3.2".

export function foldVietnamese(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Bỏ dấu, chữ thường, dấu câu (trừ . , - trong số như 3.2) thành khoảng trắng. */
function normalize(s: string): string {
  return foldVietnamese(s)
    .replace(/[–—_/\\|()[\]{}"'“”‘’:;!?*+#@&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchWords(query: string): string[] {
  return normalize(query).split(' ').filter(Boolean);
}

/** Mọi từ của `query` đều có trong `text` (thứ tự bất kỳ). */
export function matchText(query: string, text: string): boolean {
  const ws = searchWords(query);
  if (!ws.length) return true;
  const t = normalize(text);
  return ws.every((w) => t.includes(w));
}

/** Dùng cho `filterOption` của Select/AutoComplete (lọc tại máy). */
export function filterByLabel(input: string, opt?: { label?: unknown; value?: unknown }): boolean {
  return matchText(input, String(opt?.label ?? opt?.value ?? ''));
}
