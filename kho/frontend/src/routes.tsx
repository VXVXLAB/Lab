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
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductGroupsPage, WarehousesPage } from './pages/catalog/SimpleCatalogPage';
import { ProductsPage } from './pages/catalog/ProductsPage';
import { PartnersPage } from './pages/catalog/PartnersPage';
import { CashAccountsPage } from './pages/catalog/CashAccountsPage';
import { UsersPage } from './pages/catalog/UsersPage';
import { DocumentListPage } from './pages/documents/DocumentListPage';
import { DocumentRoute } from './pages/documents/DocumentEditor';
import { paths } from './paths';
import { CashBookPage, DebtSummaryPage } from './pages/vouchers/MoneyPages';
import { VoucherListPage } from './pages/vouchers/VoucherListPage';
import { VoucherRoute } from './pages/vouchers/VoucherEditor';
import { GuidePage } from './pages/GuidePage';
import { StockLedgerPage, StockNxtPage, StockSummaryPage } from './pages/reports/StockPages';
import { PurchasesReportPage, ReorderPage, ReportsHub, SalesHistoryPage, SalesReportPage } from './pages/reports/OtherReportPages';
import { CompanySettingsPage } from './pages/catalog/CompanySettingsPage';
import { FeaturesPage } from './pages/extended/FeaturesPage';
import { PermissionsPage } from './pages/extended/PermissionsPage';
import { PeriodLockPage } from './pages/extended/PeriodLockPage';
import { ImportPage } from './pages/extended/ImportPage';
import { DebtAgingPage, LowStockPage, ProfitPage } from './pages/extended/ExtReports';
import type { Need } from './auth/guard';

export { paths };

export interface ScreenDef {
  path: string;
  label: string;
  element: ReactNode;
  adminOnly?: boolean;
  /** Bản mở rộng: tính năng phải bật / quyền cần có (không có ⇒ ẩn khỏi menu, mở thẳng thì báo không có quyền) */
  need?: Need;
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
      { path: paths.sales, label: 'Phiếu bán', element: <DocumentListPage key="sale" type="sale" /> },
      { path: paths.salesReturns, label: 'Khách trả hàng', element: <DocumentListPage key="sale_return" type="sale_return" /> },
      { path: paths.drafts, label: 'Phiếu tạm đang treo', element: <DocumentListPage key="drafts" draftsOnly /> },
    ],
  },
  {
    key: 'mua-hang',
    label: 'Mua hàng',
    icon: <ShopOutlined />,
    items: [
      { path: paths.purchases, label: 'Phiếu nhập', element: <DocumentListPage key="purchase" type="purchase" /> },
      { path: paths.purchaseReturns, label: 'Trả hàng NCC', element: <DocumentListPage key="purchase_return" type="purchase_return" /> },
      { path: paths.reorder, label: 'Hàng cần đặt', element: <ReorderPage /> },
    ],
  },
  {
    key: 'kho',
    label: 'Kho',
    icon: <DatabaseOutlined />,
    items: [
      { path: paths.stock, label: 'Tồn kho', element: <StockSummaryPage /> },
      { path: paths.stockLedger, label: 'Thẻ kho / NXT', element: <StockLedgerPage /> },
      { path: paths.stockNxt, label: 'Tổng hợp NXT', element: <StockNxtPage /> },
      { path: paths.transfers, label: 'Chuyển kho', element: <DocumentListPage key="transfer" type="transfer" /> },
      { path: paths.opening, label: 'Tồn đầu kỳ', element: <DocumentListPage key="opening" type="opening" /> },
      { path: paths.stocktakes, label: 'Kiểm kê', element: <DocumentListPage key="stocktake" type="stocktake" />, need: { feature: 'stocktake' } },
    ],
  },
  {
    key: 'cong-no',
    label: 'Công nợ',
    icon: <SolutionOutlined />,
    items: [
      { path: paths.receivable, label: 'Phải thu khách hàng', element: <DebtSummaryPage key="r" side="receivable" />, need: { all: ['debt.view'] } },
      { path: paths.payable, label: 'Phải trả nhà cung cấp', element: <DebtSummaryPage key="p" side="payable" />, need: { all: ['debt.view', 'cost.view'] } },
    ],
  },
  {
    key: 'quy',
    label: 'Quỹ & Ngân hàng',
    icon: <BankOutlined />,
    items: [
      { path: paths.receipts, label: 'Thu tiền', element: <VoucherListPage key="r" type="receipt" />, need: { any: ['cash.view', 'cash.write'] } },
      { path: paths.payments, label: 'Chi tiền', element: <VoucherListPage key="p" type="payment" />, need: { any: ['cash.view', 'cash.write'] } },
      { path: paths.cashBook, label: 'Sổ quỹ / Sổ ngân hàng', element: <CashBookPage />, need: { all: ['cash.view'] } },
    ],
  },
  {
    key: 'bao-cao',
    label: 'Báo cáo',
    icon: <BarChartOutlined />,
    screen: { path: paths.reports, label: 'Báo cáo', element: <ReportsHub /> },
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
      { path: paths.importExcel, label: 'Nhập từ Excel', element: <ImportPage />, need: { feature: 'import_excel', any: ['catalog.write', 'stock.write', 'sale.write'] } },
      // quản trị bật/tắt tính năng mở rộng: có ở CẢ bản chuẩn (để bản chuẩn bật được tính năng)
      { path: paths.features, label: 'Tính năng mở rộng', element: <FeaturesPage />, adminOnly: true },
    ],
  },
  {
    key: 'he-thong',
    label: 'Hệ thống',
    icon: <SettingOutlined />,
    adminOnly: true,
    items: [
      { path: paths.users, label: 'Người dùng', element: <UsersPage />, adminOnly: true },
      { path: paths.company, label: 'Thông tin công ty', element: <CompanySettingsPage />, adminOnly: true },
      { path: paths.rolePermissions, label: 'Phân quyền', element: <PermissionsPage />, adminOnly: true, need: { feature: 'permissions' } },
      { path: paths.periodLock, label: 'Khóa sổ', element: <PeriodLockPage />, adminOnly: true, need: { feature: 'period_lock' } },
    ],
  },
  {
    key: 'huong-dan',
    label: 'Hướng dẫn',
    icon: <QuestionCircleOutlined />,
    screen: { path: paths.guide, label: 'Hướng dẫn sử dụng', element: <GuidePage /> },
  },
];

/** Màn không nằm trên menu (mở từ chỗ khác). */
export const hiddenScreens: ScreenDef[] = [
  { path: '/chung-tu/:id', label: 'Chứng từ', element: <DocumentRoute /> },
  { path: '/phieu-thu-chi/:id', label: 'Phiếu thu chi', element: <VoucherRoute /> },
  { path: paths.salesReport, label: 'Chi tiết bán hàng', element: <SalesReportPage />, need: { all: ['report.view'] } },
  { path: paths.salesHistory, label: 'Lịch sử bán theo mặt hàng', element: <SalesHistoryPage />, need: { all: ['report.view'] } },
  { path: paths.purchasesReport, label: 'Chi tiết mua hàng', element: <PurchasesReportPage />, need: { all: ['report.view', 'cost.view'] } },
  // bản mở rộng M2 (mở từ trang Báo cáo / Tổng quan)
  { path: paths.lowStock, label: 'Hàng dưới mức tối thiểu', element: <LowStockPage />, need: { feature: 'min_stock' } },
  { path: paths.debtAging, label: 'Tuổi nợ phải thu', element: <DebtAgingPage />, need: { feature: 'credit_limit', all: ['debt.view'] } },
  { path: paths.profit, label: 'Lãi gộp', element: <ProfitPage />, need: { feature: 'profit_report', all: ['report.view', 'cost.view'] } },
];

export function allScreens(): (ScreenDef & { groupKey?: string; groupLabel?: string })[] {
  const out: (ScreenDef & { groupKey?: string; groupLabel?: string })[] = [];
  for (const g of menu) {
    if (g.screen) out.push({ ...g.screen, groupKey: g.key });
    for (const it of g.items ?? []) out.push({ ...it, adminOnly: it.adminOnly ?? g.adminOnly, groupKey: g.key, groupLabel: g.label });
  }
  return out.concat(hiddenScreens);
}
