// localStorage chỉ dùng cho tiện ích từng máy (tên đăng nhập gần nhất, menu thu gọn).
// Có thể bị chặn (chế độ riêng tư) ⇒ luôn bọc try/catch.
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* bỏ qua */
    }
  },
};
