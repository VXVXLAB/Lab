import type { DocType, PartnerType } from '../../api/types';
import { paths } from '../../paths';

export interface DocTypeConfig {
  type: DocType;
  /** Tên phiếu dùng trong tiêu đề, câu thông báo */
  name: string;
  /** Tiêu đề danh sách */
  listTitle: string;
  listPath: string;
  /** Tiêu đề in khi đã ghi sổ (khớp file xuất của máy chủ) */
  printTitle: string;
  partner: PartnerType | null;
  partnerLabel: string;
  warehouseLabel: string;
  /** Có kho nhận (chuyển kho) */
  toWarehouse: boolean;
  /** Có đơn giá / thành tiền */
  hasPrice: boolean;
  /** Giá mặc định lấy từ trường nào của mặt hàng */
  defaultPrice: 'sale_price' | 'purchase_price' | null;
  /** Phiếu làm giảm tồn kho của `warehouse_id` ⇒ đánh dấu thiếu hàng */
  outgoing: boolean;
  /** Được dùng mã dịch vụ DV */
  allowService: boolean;
  /** Có Nợ cũ / Tổng nợ */
  hasDebt: boolean;
  /** Cảnh báo bán lỗ */
  lossCheck: boolean;
}

export const DOC_TYPES: Record<DocType, DocTypeConfig> = {
  sale: {
    type: 'sale',
    name: 'Phiếu bán hàng',
    listTitle: 'Phiếu bán hàng',
    listPath: paths.sales,
    printTitle: 'PHIẾU XUẤT KHO BÁN HÀNG',
    partner: 'customer',
    partnerLabel: 'Khách hàng',
    warehouseLabel: 'Xuất từ kho',
    toWarehouse: false,
    hasPrice: true,
    defaultPrice: 'sale_price',
    outgoing: true,
    allowService: true,
    hasDebt: true,
    lossCheck: true,
  },
  sale_return: {
    type: 'sale_return',
    name: 'Phiếu khách trả hàng',
    listTitle: 'Khách trả hàng',
    listPath: paths.salesReturns,
    printTitle: 'PHIẾU NHẬP HÀNG BÁN BỊ TRẢ LẠI',
    partner: 'customer',
    partnerLabel: 'Khách hàng',
    warehouseLabel: 'Nhập vào kho',
    toWarehouse: false,
    hasPrice: true,
    defaultPrice: 'sale_price',
    outgoing: false,
    allowService: true,
    hasDebt: false,
    lossCheck: false,
  },
  purchase: {
    type: 'purchase',
    name: 'Phiếu nhập mua hàng',
    listTitle: 'Phiếu nhập mua hàng',
    listPath: paths.purchases,
    printTitle: 'PHIẾU NHẬP KHO MUA HÀNG',
    partner: 'supplier',
    partnerLabel: 'Nhà cung cấp',
    warehouseLabel: 'Nhập vào kho',
    toWarehouse: false,
    hasPrice: true,
    defaultPrice: 'purchase_price',
    outgoing: false,
    allowService: true,
    hasDebt: true,
    lossCheck: false,
  },
  purchase_return: {
    type: 'purchase_return',
    name: 'Phiếu trả hàng nhà cung cấp',
    listTitle: 'Trả hàng nhà cung cấp',
    listPath: paths.purchaseReturns,
    printTitle: 'PHIẾU XUẤT TRẢ HÀNG NHÀ CUNG CẤP',
    partner: 'supplier',
    partnerLabel: 'Nhà cung cấp',
    warehouseLabel: 'Xuất từ kho',
    toWarehouse: false,
    hasPrice: true,
    defaultPrice: 'purchase_price',
    outgoing: true,
    allowService: true,
    hasDebt: false,
    lossCheck: false,
  },
  transfer: {
    type: 'transfer',
    name: 'Phiếu chuyển kho',
    listTitle: 'Chuyển kho nội bộ',
    listPath: paths.transfers,
    printTitle: 'PHIẾU CHUYỂN KHO NỘI BỘ',
    partner: null,
    partnerLabel: '',
    warehouseLabel: 'Kho xuất',
    toWarehouse: true,
    hasPrice: false,
    defaultPrice: null,
    outgoing: true,
    allowService: false,
    hasDebt: false,
    lossCheck: false,
  },
  opening: {
    type: 'opening',
    name: 'Phiếu nhập tồn đầu kỳ',
    listTitle: 'Tồn đầu kỳ',
    listPath: paths.opening,
    printTitle: 'PHIẾU NHẬP TỒN ĐẦU KỲ',
    partner: null,
    partnerLabel: '',
    warehouseLabel: 'Nhập vào kho',
    toWarehouse: false,
    hasPrice: true,
    defaultPrice: 'purchase_price',
    outgoing: false,
    allowService: false,
    hasDebt: false,
    lossCheck: false,
  },
};

export const DOC_TYPE_LIST: DocType[] = ['sale', 'sale_return', 'purchase', 'purchase_return', 'transfer', 'opening'];

export function isDocType(s: string | undefined): s is DocType {
  return !!s && (DOC_TYPE_LIST as string[]).includes(s);
}
