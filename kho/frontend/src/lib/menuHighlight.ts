// Màn mở từ chỗ khác (vd. /chung-tu/:id) báo cho khung biết đang thuộc mục menu nào để tô sáng và hiện tiêu đề.
import { useEffect, useSyncExternalStore } from 'react';

export interface MenuOverride {
  /** Đường dẫn mục menu cần tô sáng */
  path: string;
  /** Tiêu đề trên thanh trên / tab trình duyệt */
  title: string;
}

let current: MenuOverride | null = null;
const subs = new Set<() => void>();
function set(v: MenuOverride | null) {
  current = v;
  subs.forEach((f) => f());
}

export function useMenuOverride(): MenuOverride | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
  );
}

export function useMenuHighlight(path: string | null, title: string): void {
  useEffect(() => {
    if (!path) return undefined;
    set({ path, title });
    return () => set(null);
  }, [path, title]);
}
