import { useCallback, useRef, useState } from 'react';

/**
 * Dòng đang chọn của bảng (↑ ↓ Enter). Giữ thêm bản sao trong ref để phím bấm ngay sau khi chọn
 * (vd. Enter thứ hai đến trước khi trang kịp vẽ lại) vẫn thấy đúng dòng (F-15).
 */
export function useActiveRow(): [number, (v: number | ((i: number) => number)) => void, { readonly current: number }] {
  const [idx, setIdx] = useState(-1);
  const ref = useRef(-1);
  const set = useCallback((v: number | ((i: number) => number)) => {
    const n = typeof v === 'function' ? v(ref.current) : v;
    ref.current = n;
    setIdx(n);
  }, []);
  return [idx, set, ref];
}
