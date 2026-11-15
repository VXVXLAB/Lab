import type { ReactNode } from 'react';

/**
 * Chỉ xem (bản mở rộng: không có quyền sửa / phiếu trong kỳ đã khóa sổ): khóa mọi ô nhập bên trong bằng
 * `<fieldset disabled>` (display: contents ⇒ không đổi bố cục). Không chỉ xem ⇒ không thêm phần tử nào.
 */
export function ReadOnlyWrap({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return (
    <fieldset disabled className="ro-fieldset">
      {children}
    </fieldset>
  );
}
