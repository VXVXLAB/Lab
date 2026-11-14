import type { ReactNode } from 'react';

/** Gợi ý phím tắt nhỏ, kín đáo. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
