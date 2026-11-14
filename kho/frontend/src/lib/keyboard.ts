// Tiện ích bàn phím dùng chung. Quy ước phím của cả ứng dụng (ghi trong docs/FRONTEND.md):
//   F2 thêm mới · F3 hoặc / tìm kiếm · ↑ ↓ chọn dòng · Enter mở/sửa · Delete xóa
//   Trong biểu mẫu: Enter sang ô kế tiếp (ô cuối ⇒ lưu) · Ctrl+S lưu · Esc đóng
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Có hộp thoại (Modal/Drawer/confirm) đang mở không — khi đó phím tắt của trang tạm ngừng. */
export function isOverlayOpen(): boolean {
  const wraps = document.querySelectorAll<HTMLElement>('.ant-modal-wrap, .ant-drawer-open');
  for (const w of wraps) {
    if (w.classList.contains('ant-drawer-open')) return true;
    if (getComputedStyle(w).display !== 'none') return true;
  }
  return false;
}

export type HotkeyMap = Record<string, (e: KeyboardEvent) => void>;

function keyName(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && e.key.length > 1) parts.push('Shift');
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join('+');
}

/**
 * Phím tắt cấp trang. Khóa: 'F2', 'F3', '/', 'Ctrl+s'…
 * Phím ký tự (vd. '/') bị bỏ qua khi đang gõ trong ô nhập; phím F, Ctrl+… luôn nhận.
 * Tạm ngừng khi có hộp thoại đang mở (trừ khi `inOverlay`).
 */
export function useHotkeys(map: HotkeyMap, opts: { enabled?: boolean; inOverlay?: boolean } = {}): void {
  const ref = useRef(map);
  ref.current = map;
  const enabled = opts.enabled ?? true;
  const inOverlay = opts.inOverlay ?? false;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const name = keyName(e);
      const fn = ref.current[name];
      if (!fn) return;
      const isPlainChar = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (isPlainChar && isTypingTarget(e.target)) return;
      if (!inOverlay && isOverlayOpen()) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, inOverlay]);
}

const FOCUSABLE =
  'input:not([type=hidden]):not([disabled]):not([readonly]), textarea:not([disabled]), button.ant-switch:not([disabled]), [role=combobox]:not([disabled])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.closest('[data-enter-skip]')) return false;
    // Nhóm lựa chọn tròn: chỉ dừng ở ô đang chọn (mũi tên để đổi lựa chọn)
    if (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked) return false;
    if (el.closest('.ant-select-disabled, .ant-picker-disabled, .ant-checkbox-wrapper-disabled')) return false;
    // ô tìm của Select nằm trong .ant-select; chỉ lấy một phần tử cho mỗi Select
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || el.getAttribute('role') === 'combobox';
  });
}

export function focusFirstField(root: HTMLElement | null): void {
  if (!root) return;
  const first = focusables(root)[0];
  if (first) {
    first.focus();
    if (first instanceof HTMLInputElement) first.select();
  }
}

/**
 * Gắn vào `onKeyDownCapture` của vùng biểu mẫu: Enter ⇒ sang ô kế tiếp; ô cuối ⇒ gọi `onLastEnter` (lưu).
 * Không can thiệp: textarea, danh sách chọn đang mở (Enter để chọn), nút bấm, tổ hợp có Ctrl/Shift/Alt.
 */
export function enterToNext(onLastEnter?: () => void) {
  return (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
    if (e.nativeEvent.isComposing) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'TEXTAREA') return;
    if (t.tagName === 'BUTTON' && !t.classList.contains('ant-switch')) return; // công tắc: Enter đi tiếp, Space bật/tắt
    if (t.getAttribute('aria-expanded') === 'true') {
      // Danh sách chọn đang mở: để antd lấy mục đang sáng, rồi đi tiếp luôn — MỘT lần Enter là chọn + sang ô sau.
      const active = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active');
      if (t.getAttribute('role') === 'combobox' && active) {
        const list = focusables(e.currentTarget);
        const next = list[list.indexOf(t) + 1];
        window.setTimeout(() => {
          if (next) {
            next.focus();
            if (next instanceof HTMLInputElement && next.type !== 'checkbox') next.select();
          } else onLastEnter?.();
        }, 0);
      }
      return;
    }
    if (t.closest('.ant-picker') && document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)')) return;
    const root = e.currentTarget;
    const list = focusables(root);
    const idx = list.indexOf(t);
    if (idx < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const next = list[idx + 1];
    if (next) {
      next.focus();
      if (next instanceof HTMLInputElement && next.type !== 'checkbox') next.select();
    } else {
      onLastEnter?.();
    }
  };
}
