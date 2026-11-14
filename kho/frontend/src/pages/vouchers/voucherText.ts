import type { CashAccountKind, DebtSide, VoucherType } from '../../api/types';

/** Một chỗ cho câu chữ về thu chi (thống nhất mọi màn). */
export const VOUCHER_TITLE: Record<VoucherType, Record<CashAccountKind, string>> = {
  receipt: { cash: 'PHIẾU THU', bank: 'GIẤY BÁO CÓ (THU QUA NGÂN HÀNG)' },
  payment: { cash: 'PHIẾU CHI', bank: 'GIẤY BÁO NỢ (CHI QUA NGÂN HÀNG)' },
};

export const VOUCHER_PREFIX: Record<VoucherType, Record<CashAccountKind, string>> = {
  receipt: { cash: 'PT', bank: 'BC' },
  payment: { cash: 'PC', bank: 'BN' },
};

/** Ý nghĩa của debt_side theo lời kế toán. */
export const DEBT_EFFECT: Record<VoucherType, Record<DebtSide, string>> = {
  receipt: {
    receivable: 'Khách trả tiền — giảm số khách đang nợ (phải thu)',
    payable: 'Nhà cung cấp hoàn tiền cho mình — tăng lại số phải trả',
  },
  payment: {
    payable: 'Trả tiền mua hàng cho nhà cung cấp — giảm số mình đang nợ (phải trả)',
    receivable: 'Trả lại tiền cho khách — tăng lại số phải thu',
  },
};

export const SIDE_LABEL: Record<DebtSide, string> = { receivable: 'Phải thu', payable: 'Phải trả' };

/** Ảnh hưởng (có dấu) của một phiếu lên số dư phía debt_side. */
export function debtEffect(type: VoucherType, side: DebtSide, amount: number): number {
  if (type === 'receipt') return side === 'receivable' ? -amount : amount;
  return side === 'payable' ? -amount : amount;
}

/** debt_side mặc định như máy chủ: thu → phải thu, chi → phải trả; trừ đối tác chỉ là NCC / chỉ là KH. */
export function defaultDebtSide(type: VoucherType, p: { is_customer?: boolean; is_supplier?: boolean } | null): DebtSide {
  if (type === 'receipt') return p && p.is_supplier && !p.is_customer ? 'payable' : 'receivable';
  return p && p.is_customer && !p.is_supplier ? 'receivable' : 'payable';
}
