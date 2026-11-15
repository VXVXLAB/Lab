import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { focusNextField } from './keyboard';

/** Tiêu đề mục đang sáng trong danh sách đang mở của ô chọn `input` (null nếu không có). */
function activeOptionTitle(input: HTMLElement): string | null {
  const listId = input.getAttribute('aria-controls');
  const list = listId ? document.getElementById(listId) : null;
  const dropdown = list?.closest('.ant-select-dropdown');
  if (!dropdown || dropdown.classList.contains('ant-select-dropdown-hidden')) return null;
  return dropdown.querySelector<HTMLElement>('.ant-select-item-option-active')?.getAttribute('title') ?? null;
}

/**
 * Ô chọn có tìm kiếm (khách, mặt hàng): khi đang có chữ gõ, Enter do ô này xử lý trọn (F-05, F-11):
 * - kết quả chưa phải của chữ đang gõ (`stale`) ⇒ chờ, có kết quả thì chọn mục đầu;
 * - kết quả đã đúng ⇒ chọn mục đang sáng (↑ ↓ / chuột), không có mục sáng thì mục đầu;
 * - không có kết quả ⇒ giữ nguyên chữ đã gõ (không bao giờ xóa chữ mà không chọn gì).
 * Chọn xong: sang ô kế tiếp của biểu mẫu (nếu có), hoặc đóng danh sách.
 */
export function useSearchEnterGuard(typing: boolean, stale: boolean, pick: (activeTitle: string | null) => boolean) {
  const pending = useRef(false);
  /** Người dùng đã tự dời mục sáng bằng ↑ ↓ sau lần gõ cuối */
  const moved = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const run = (activeTitle: string | null) => {
    if (!pickRef.current(activeTitle)) return;
    const input = wrapRef.current?.querySelector<HTMLInputElement>('input');
    window.setTimeout(() => {
      if (!input) return;
      // không có ô kế tiếp (bộ lọc, thẻ kho): con trỏ ở lại; danh sách đã được ô chọn đóng hẳn (F-17)
      if (input.closest('[data-enter-scope]')) focusNextField(input);
    }, 0);
  };
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    if (stale || !pending.current) return;
    pending.current = false;
    runRef.current(null);
  }, [stale]);
  useEffect(() => {
    if (!typing) pending.current = false;
  }, [typing]);
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') moved.current = true;
    else if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') moved.current = false;
    if (e.key !== 'Enter' || e.ctrlKey || e.altKey || e.metaKey || !typing) return;
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (stale) {
      pending.current = true;
      return;
    }
    runRef.current(moved.current ? activeOptionTitle(e.target as HTMLElement) : null);
  };
  return {
    wrapRef,
    onKeyDownCapture,
    pendingAttr: typing && stale ? 'true' : undefined,
    ownerAttr: typing ? 'true' : undefined,
  };
}

export function useListSearchEnter<T>(o: {
  text: string;
  committed: string;
  flush: () => void;
  /** Dữ liệu đang hiện là của bộ lọc hiện tại và không đang tải */
  fresh: boolean;
  rows: T[];
  focusFirst: () => void;
  openFirst: (r: T) => void;
}) {
  const pending = useRef(0);
  const [tick, setTick] = useState(0);
  const ready = o.committed === o.text.trim() && o.fresh;
  const ref = useRef(o);
  ref.current = o;
  useEffect(() => {
    if (!ready || pending.current === 0) return;
    const n = pending.current;
    pending.current = 0;
    const first = ref.current.rows[0];
    if (!first) return;
    ref.current.focusFirst();
    if (n >= 2) ref.current.openFirst(first);
  }, [ready, tick]);
  return (e: KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (ready && pending.current === 0) {
      // kết quả đã đúng chữ đang gõ: xuống dòng đầu ngay (Enter kế tiếp ở bảng sẽ mở dòng đó)
      if (o.rows.length) o.focusFirst();
      return;
    }
    if (!ready) o.flush();
    pending.current = Math.min(2, pending.current + 1);
    setTick((t) => t + 1);
  };
}
