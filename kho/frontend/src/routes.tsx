// Bản đồ màn hình duy nhất: menu trái, đường dẫn và tiêu đề trang đều đọc từ đây.
// Giai đoạn sau chỉ cần thay `element` của mục tương ứng (đường dẫn giữ nguyên ⇒ điều hướng ổn định).
import type { ReactNode } from 'react';
import {
  AppstoreOutlined,
  BankOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SolutionOutlined,
} from '@ant-design/icons';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductGroupsPage, WarehousesPage } from './pages/catalog/SimpleCatalogPage';
import { ProductsPage } from './pages/catalog/ProductsPage';
import { PartnersPage } from './pages/catalog/PartnersPage';
import { CashAccountsPage } from './pages/catalog/CashAccountsPage';
import { UsersPage } from './pages/catalog/UsersPage';
import { Placeholder } from './components/Placeholder';
import { paths } from './paths';

export { paths };

export interface ScreenDef {
  path: string;
  label: string;
  element: ReactNode;
  adminOnly?: boolean;
}

export interface MenuGroup {
  key: string;
  label: string;
  icon: ReactNode;
  /** Mục đơn (không có nhóm con) */
  screen?: ScreenDef;
  items?: ScreenDef[];
  adminOnly?: boolean;
}

const soon = (title: string, note?: string) => <Placeholder title={title} note={note} />;

export const menu: MenuGroup[] = [
  {
    key: 'tong-quan',
    label: 'Tổng quan',
    icon: <DashboardOutlined />,
    screen: { path: paths.home, label: 'Tổng quan', element: <DashboardPage /> },
  },
  {
    key: 'ban-hang',
    label: 'Bán hàng',
    icon: <ShoppingCartOutlined />,
    items: [
      { path: paths.sales, label: 'Phiếu bán', element: soon('Phiếu bán hàng') },
      { path: paths.salesReturns, label: 'Khách trả hàng', element: soon('Phiếu nhập hàng bán bị trả lại') },
      { path: paths.drafts, label: 'Phiếu tạm đang treo', element: soon('Phiếu tạm đang treo', 'Tạm thời xem 10 phiếu tạm mới nhất ở màn Tổng quan.') },
    ],
  },
  {
    key: 'mua-hang',
    label: 'Mua hàng',
    icon: <ShopOutlined />,
    items: [
      { path: paths.purchases, label: 'Phiếu nhập', element: soon('Phiếu nhập mua hàng') },
      { path: paths.purchaseReturns, label: 'Trả hàng NCC', element: soon('Phiếu xuất trả hàng nhà cung cấp') },
      { path: paths.reorder, label: 'Hàng cần đặt', element: soon('Hàng cần đặt (từ phiếu bán tạm)') },
    ],
  },
  {
    key: 'kho',
    label: 'Kho',
    icon: <DatabaseOutlined />,
    items: [
      { path: paths.stock, label: 'Tồn kho', element: soon('Tồn kho') },
      { path: paths.stockLedger, label: 'Thẻ kho / NXT', element: soon('Thẻ kho – chi tiết nhập xuất tồn') },
      { path: paths.transfers, label: 'Chuyển kho', element: soon('Phiếu chuyển kho nội bộ') },
      { path: paths.opening, label: 'Tồn đầu kỳ', element: soon('Phiếu nhập tồn đầu kỳ') },
    ],
  },
  {
    key: 'cong-no',
    label: 'Công nợ',
    icon: <SolutionOutlined />,
    items: [
      { path: paths.receivable, label: 'Phải thu khách hàng', element: soon('Công nợ phải thu khách hàng') },
      { path: paths.payable, label: 'Phải trả nhà cung cấp', element: soon('Công nợ phải trả nhà cung cấp') },
    ],
  },
  {
    key: 'quy',
    label: 'Quỹ & Ngân hàng',
    icon: <BankOutlined />,
    items: [
      { path: paths.receipts, label: 'Thu tiền', element: soon('Phiếu thu tiền') },
      { path: paths.payments, label: 'Chi tiền', element: soon('Phiếu chi tiền') },
      { path: paths.cashBook, label: 'Sổ quỹ / Sổ ngân hàng', element: soon('Sổ quỹ tiền mặt / Sổ tiền gửi ngân hàng') },
    ],
  },
  {
    key: 'bao-cao',
    label: 'Báo cáo',
    icon: <BarChartOutlined />,
    screen: { path: paths.reports, label: 'Báo cáo', element: soon('Báo cáo') },
  },
  {
    key: 'danh-muc',
    label: 'Danh mục',
    icon: <AppstoreOutlined />,
    items: [
      { path: paths.products, label: 'Hàng hóa, dịch vụ', element: <ProductsPage /> },
      { path: paths.productGroups, label: 'Nhóm hàng', element: <ProductGroupsPage /> },
      { path: paths.customers, label: 'Khách hàng', element: <PartnersPage type="customer" /> },
      { path: paths.suppliers, label: 'Nhà cung cấp', element: <PartnersPage type="supplier" /> },
      { path: paths.warehouses, label: 'Kho', element: <WarehousesPage /> },
      { path: paths.cashAccounts, label: 'Tài khoản tiền', element: <CashAccountsPage /> },
    ],
  },
  {
    key: 'he-thong',
    label: 'Hệ thống',
    icon: <SettingOutlined />,
    adminOnly: true,
    items: [{ path: paths.users, label: 'Người dùng', element: <UsersPage />, adminOnly: true }],
  },
];

/** Màn không nằm trên menu (mở từ chỗ khác). */
export const hiddenScreens: ScreenDef[] = [
  { path: '/chung-tu/:id', label: 'Chứng từ', element: soon('Xem / sửa chứng từ') },
  { path: '/phieu-thu-chi/:id', label: 'Phiếu thu chi', element: soon('Xem / sửa phiếu thu chi') },
];

export function allScreens(): (ScreenDef & { groupKey?: string; groupLabel?: string })[] {
  const out: (ScreenDef & { groupKey?: string; groupLabel?: string })[] = [];
  for (const g of menu) {
    if (g.screen) out.push({ ...g.screen, groupKey: g.key });
    for (const it of g.items ?? []) out.push({ ...it, adminOnly: it.adminOnly ?? g.adminOnly, groupKey: g.key, groupLabel: g.label });
  }
  return out.concat(hiddenScreens);
}
