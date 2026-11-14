// Giữ phiếu đang gõ dở khi phiên đăng nhập hết giữa chừng (F-04): lưu tạm trong sessionStorage của tab,
// theo NGƯỜI DÙNG + PHIẾU. Đăng nhập lại đúng người đó ⇒ khôi phục; lưu phiếu / bỏ thay đổi / đăng xuất ⇒ xóa.
const PREFIX = 'kho.unsaved.';

const k = (userId: number, scope: string) => `${PREFIX}${userId}.${scope}`;
/** Lúc phiên đăng nhập bị ngắt gần nhất trên tab này (để báo đúng lý do khi khôi phục — F-14) */
const ENDED = 'kho.sessionEndedAt';

function savedAt(userId: number, scope: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(k(userId, scope));
    return raw ? (JSON.parse(raw) as { at: number }).at : null;
  } catch {
    return null;
  }
}

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
  /** Phiên đăng nhập vừa bị ngắt (máy chủ trả 401). */
  markSessionEnded(): void {
    try {
      window.sessionStorage.setItem(ENDED, String(Date.now()));
    } catch {
      /* bỏ qua */
    }
  },
  /**
   * Vì sao còn phiếu gõ dở để khôi phục: 'session' nếu phiên bị ngắt SAU lần lưu tạm cuối (bị đẩy ra màn đăng nhập),
   * ngược lại 'reload' (tải lại trang, mở lại tab).
   */
  reason(userId: number, scope: string): 'session' | 'reload' {
    try {
      const ended = Number(window.sessionStorage.getItem(ENDED) ?? 0);
      const at = savedAt(userId, scope);
      return ended && at !== null && ended >= at ? 'session' : 'reload';
    } catch {
      return 'reload';
    }
  },
  /** Câu báo khi khôi phục */
  restoredMessage(reason: 'session' | 'reload'): string {
    return reason === 'session'
      ? 'Phiên đăng nhập đã hết. Đã khôi phục các dòng đang gõ dở — kiểm tra rồi bấm Lưu.'
      : 'Đã khôi phục các dòng đang gõ dở từ lần mở trước — kiểm tra rồi bấm Lưu.';
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
