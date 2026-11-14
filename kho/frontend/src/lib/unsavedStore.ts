// Giữ phiếu đang gõ dở khi phiên đăng nhập hết giữa chừng (F-04): lưu tạm trong sessionStorage của tab,
// theo NGƯỜI DÙNG + PHIẾU. Đăng nhập lại đúng người đó ⇒ khôi phục; lưu phiếu / bỏ thay đổi / đăng xuất ⇒ xóa.
const PREFIX = 'kho.unsaved.';

const k = (userId: number, scope: string) => `${PREFIX}${userId}.${scope}`;

export const unsavedStore = {
  save(userId: number, scope: string, data: unknown): void {
    try {
      window.sessionStorage.setItem(k(userId, scope), JSON.stringify({ at: Date.now(), data }));
    } catch {
      /* đầy bộ nhớ / bị chặn: bỏ qua */
    }
  },
  load<T>(userId: number, scope: string): T | null {
    try {
      const raw = window.sessionStorage.getItem(k(userId, scope));
      if (!raw) return null;
      const v = JSON.parse(raw) as { at: number; data: T };
      // quá 12 giờ coi như bỏ
      if (Date.now() - v.at > 12 * 3600_000) return null;
      return v.data;
    } catch {
      return null;
    }
  },
  clear(userId: number, scope: string): void {
    try {
      window.sessionStorage.removeItem(k(userId, scope));
    } catch {
      /* bỏ qua */
    }
  },
  /** Đăng xuất chủ động ⇒ bỏ mọi phiếu gõ dở của người đó trên tab này. */
  clearUser(userId: number): void {
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith(`${PREFIX}${userId}.`)) keys.push(key);
      }
      keys.forEach((key) => window.sessionStorage.removeItem(key));
    } catch {
      /* bỏ qua */
    }
  },
};
