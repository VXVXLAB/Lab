import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { focusNextField } from './keyboard';

/**
 * Chặn Enter chọn nhầm trên kết quả tìm CŨ (F-05): khi chữ đang gõ chưa có kết quả (đang chờ / đang hỏi máy chủ),
 * Enter được ghi nhớ; khi kết quả của ĐÚNG chữ đó về thì mới chọn mục đầu (theo thứ tự máy chủ) và sang ô kế tiếp.
 * Không có kết quả ⇒ không chọn gì.
 */
export function useSearchEnterGuard(stale: boolean, pickFirst: () => boolean) {
  const pending = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef(pickFirst);
  pickRef.current = pickFirst;
  useEffect(() => {
    if (stale || !pending.current) return;
    pending.current = false;
    if (pickRef.current()) {
      const input = wrapRef.current?.querySelector<HTMLElement>('input');
      window.setTimeout(() => focusNextField(input ?? null), 0);
    }
  }, [stale]);
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey && stale) {
      e.preventDefault();
      e.stopPropagation();
      pending.current = true;
    }
  };
  return { wrapRef, onKeyDownCapture, pendingAttr: stale ? 'true' : undefined };
}

/**
 * Enter ở ô tìm của màn danh sách (F-05): chỉ hành động trên kết quả của ĐÚNG chữ đang gõ.
 * Enter 1 lần ⇒ xuống dòng đầu của kết quả; Enter 2 lần liên tiếp (khi kết quả chưa về) ⇒ mở luôn dòng đầu.
 * Chưa có kết quả mới ⇒ ghi nhớ số lần Enter, nhận ngay chữ đang gõ (bỏ thời gian chờ), làm khi kết quả về.
 */
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
