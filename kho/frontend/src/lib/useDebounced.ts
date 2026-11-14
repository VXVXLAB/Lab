import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Như useDebounced nhưng có `flush()` để nhận ngay giá trị hiện tại (vd. người dùng bấm Enter
 * trước khi hết thời gian chờ — không được hành động trên kết quả của chữ cũ).
 */
export function useDebouncedFlush<T>(value: T, ms: number): [T, () => void] {
  const [v, setV] = useState(value);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  const flush = useCallback(() => setV(latest.current), []);
  return [v, flush];
}

/** Chiều cao hiện tại của một phần tử (để bảng cuộn bên trong, thanh phân trang luôn hiện). */
export function useElementHeight(ref: RefObject<HTMLElement>): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}
