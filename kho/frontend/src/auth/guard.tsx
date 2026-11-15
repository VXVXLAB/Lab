// Điều kiện hiện một màn / nút theo tính năng mở rộng và quyền (bản mở rộng, đợt M1).
// Bản chuẩn (mọi tính năng tắt): mọi người có đủ quyền như trước ⇒ chỉ còn điều kiện `feature` ẩn màn mới.
import type { ReactNode } from 'react';
import { Result } from 'antd';
import type { DocType, FeatureKey, Permission } from '../api/types';
import { DOC_TYPES, type DocTypeConfig } from '../pages/documents/docTypes';
import { useAccess, type Access } from './AuthContext';

export interface Need {
  /** Tính năng mở rộng phải bật */
  feature?: FeatureKey;
  /** Cần đủ các quyền này */
  all?: Permission[];
  /** Cần ít nhất một quyền trong số này */
  any?: Permission[];
  /** Điều kiện riêng (vd. có loại dữ liệu nhập được, có tính năng mở rộng nào bật) */
  check?: (a: Access, isAdmin: boolean) => boolean;
}

export function allowed(need: Need | undefined, a: Access, isAdmin: boolean): boolean {
  if (!need) return true;
  if (need.feature && !a.features[need.feature]) return false;
  if (need.check && !need.check(a, isAdmin)) return false;
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

// ---------- Chứng từ kho theo quyền ----------

/** Quyền lập / sửa / ghi sổ từng loại phiếu. */
export const DOC_WRITE_PERM: Record<DocType, Permission> = {
  sale: 'sale.write',
  sale_return: 'sale.write',
  purchase: 'purchase.write',
  purchase_return: 'purchase.write',
  transfer: 'stock.write',
  opening: 'stock.write',
  stocktake: 'stock.write',
};

/** Loại phiếu mang giá vốn (đơn giá = giá mua): không có quyền "Xem giá mua" ⇒ máy chủ che giá / tiền. */
export const COST_DOC_TYPES: readonly DocType[] = ['purchase', 'purchase_return', 'opening'];

export interface DocAccess {
  /** Cấu hình loại phiếu đã tính quyền: ẩn giá khi bị che giá vốn, ẩn Nợ cũ/Tổng nợ khi không xem công nợ */
  cfg: DocTypeConfig;
  /** Lập / sửa / ghi sổ / xóa phiếu tạm */
  canWrite: boolean;
  /** Sửa / bỏ ghi sổ / xóa phiếu đã ghi sổ */
  canEditPosted: boolean;
  /** Giá vốn bị che trên loại phiếu này */
  costHidden: boolean;
}

export function docAccess(type: DocType, a: Access, isAdmin: boolean): DocAccess {
  const base = DOC_TYPES[type];
  const can = (p: Permission) => isAdmin || a.permissions.has(p);
  const costHidden = COST_DOC_TYPES.includes(type) && !can('cost.view');
  const canWrite = can(DOC_WRITE_PERM[type]);
  return {
    cfg: {
      ...base,
      hasPrice: base.hasPrice && !costHidden,
      defaultPrice: costHidden ? null : base.defaultPrice,
      hasDebt: base.hasDebt && !costHidden && can('debt.view'),
    },
    canWrite,
    // không xem được giá vốn ⇒ không sửa / bỏ ghi sổ phiếu mua, trả NCC, tồn đầu đã ghi sổ (máy chủ trả 403)
    canEditPosted: canWrite && can('posted.edit') && !costHidden,
    costHidden,
  };
}

/** Quyền với một loại phiếu cho người đang đăng nhập. */
export function useDocAccess(type: DocType): DocAccess {
  const a = useAccess();
  return docAccess(type, a, a.isAdmin);
}

/** Loại phiếu người dùng được lập (thứ tự như menu). */
export function useWritableDocTypes(): DocType[] {
  const a = useAccess();
  return (Object.keys(DOC_TYPES) as DocType[]).filter((t) => a.isAdmin || a.permissions.has(DOC_WRITE_PERM[t]));
}

/** Số dư đầu kỳ đối tác được xem / sửa: phải thu cần "Xem công nợ"; phải trả cần thêm "Xem giá mua". */
export function useOpeningDebtVisibility(): { receivable: boolean; payable: boolean } {
  const a = useAccess();
  const can = (p: Permission) => a.isAdmin || a.permissions.has(p);
  return { receivable: can('debt.view'), payable: can('debt.view') && can('cost.view') };
}
