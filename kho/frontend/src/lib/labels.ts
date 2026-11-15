import type { CashAccountKind, DocType, Role } from '../api/types';

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  sale: 'Phiếu bán hàng',
  sale_return: 'Khách trả hàng',
  purchase: 'Phiếu nhập mua',
  purchase_return: 'Trả hàng NCC',
  transfer: 'Chuyển kho',
  opening: 'Tồn đầu kỳ',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Quản trị',
  ketoan: 'Kế toán',
  banhang: 'Bán hàng',
  muahang: 'Mua hàng',
  thukho: 'Thủ kho',
};

export const CASH_KIND_LABEL: Record<CashAccountKind, string> = {
  cash: 'Tiền mặt',
  bank: 'Ngân hàng',
};
