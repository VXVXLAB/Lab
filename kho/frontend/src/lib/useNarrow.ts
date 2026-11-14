import { useEffect, useState } from 'react';

/** true khi cửa sổ hẹp hơn `px` (máy tính bảng): gom bớt nút ít dùng vào menu "Thêm ▾". */
export function useNarrow(px = 1100): boolean {
  const q = `(max-width: ${px}px)`;
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setN(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [q]);
  return n;
}
