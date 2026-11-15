// Điều kiện hiện một màn / nút theo tính năng mở rộng và quyền (bản mở rộng, đợt M1).
// Bản chuẩn (mọi tính năng tắt): mọi người có đủ quyền như trước ⇒ chỉ còn điều kiện `feature` ẩn màn mới.
import type { ReactNode } from 'react';
import { Result } from 'antd';
import type { FeatureKey, Permission } from '../api/types';
import { useAccess, type Access } from './AuthContext';

export interface Need {
  /** Tính năng mở rộng phải bật */
  feature?: FeatureKey;
  /** Cần đủ các quyền này */
  all?: Permission[];
  /** Cần ít nhất một quyền trong số này */
  any?: Permission[];
}

export function allowed(need: Need | undefined, a: Access, isAdmin: boolean): boolean {
  if (!need) return true;
  if (need.feature && !a.features[need.feature]) return false;
  if (isAdmin) return true;
  if (need.all && !need.all.every((p) => a.permissions.has(p))) return false;
  if (need.any && !need.any.some((p) => a.permissions.has(p))) return false;
  return true;
}

/** Tên quyền tiếng Việt (giống máy chủ) — dùng trong thông báo "Bạn không có quyền …". */
export const PERMISSION_LABEL: Record<Permission, string> = {
  'sale.write': 'Lập phiếu bán, khách trả hàng',
  'purchase.write': 'Lập phiếu nhập mua, trả nhà cung cấp',
  'stock.write': 'Lập phiếu chuyển kho, tồn đầu kỳ, kiểm kê',
  'cash.write': 'Lập phiếu thu, phiếu chi',
  'catalog.write': 'Sửa danh mục (hàng hóa, đối tác, nhóm, kho, tài khoản tiền)',
  'posted.edit': 'Sửa / bỏ ghi sổ / xóa chứng từ đã ghi sổ',
  'cost.view': 'Xem giá mua, giá vốn, lãi',
  'debt.view': 'Xem công nợ',
  'cash.view': 'Xem sổ quỹ, ngân hàng',
  'report.view': 'Xem báo cáo mua, bán',
};

/** Một câu giải thích ngắn cho từng quyền (màn Phân quyền). */
export const PERMISSION_HINT: Record<Permission, string> = {
  'sale.write': 'Tạo, sửa, ghi sổ phiếu bán và phiếu khách trả hàng.',
  'purchase.write': 'Tạo, sửa, ghi sổ phiếu nhập mua và phiếu trả hàng nhà cung cấp.',
  'stock.write': 'Lập phiếu chuyển kho và phiếu tồn đầu kỳ; nhập tồn đầu kỳ từ Excel.',
  'cash.write': 'Lập, sửa, xóa phiếu thu, phiếu chi (kể cả "Thu tiền phiếu này").',
  'catalog.write': 'Thêm, sửa, xóa hàng hóa, khách hàng, nhà cung cấp, nhóm hàng, kho, tài khoản tiền.',
  'posted.edit': 'Sửa, bỏ ghi sổ, xóa phiếu ĐÃ ghi sổ (cần thêm quyền lập loại phiếu đó).',
  'cost.view': 'Thấy giá mua, giá vốn, đơn giá phiếu nhập và nợ phải trả. Không có quyền này: các số đó bị ẩn.',
  'debt.view': 'Xem công nợ khách hàng / nhà cung cấp, "Nợ cũ" và "Tổng nợ" trên phiếu.',
  'cash.view': 'Xem sổ quỹ, sổ ngân hàng và số dư tài khoản tiền.',
  'report.view': 'Xem báo cáo bán hàng, mua hàng và doanh thu trên Tổng quan.',
};

/** Màn hình bị chặn (gõ thẳng đường dẫn khi không có quyền / tính năng tắt). */
export function GuardedScreen({ need, children }: { need?: Need; children: ReactNode }) {
  const a = useAccess();
  if (allowed(need, a, a.isAdmin)) return <>{children}</>;
  if (need?.feature && !a.features[need.feature])
    return <Result status="404" title="Màn hình này chưa được bật" subTitle="Người quản trị bật trong Danh mục › Tính năng mở rộng." />;
  const missing = [...(need?.all ?? []), ...(need?.any ?? [])].filter((p) => !a.permissions.has(p));
  return (
    <Result
      status="403"
      title="Bạn không có quyền xem màn hình này"
      subTitle={missing.length ? `Cần quyền: ${missing.map((p) => `“${PERMISSION_LABEL[p]}”`).join(need?.any ? ' hoặc ' : ', ')}. Hãy nhờ người quản trị.` : 'Hãy nhờ người quản trị.'}
    />
  );
}
