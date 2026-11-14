// Kiểu dữ liệu đúng theo docs/API.md. Số tiền/số lượng là `number` (máy chủ trả JSON number).

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListParams {
  q?: string;
  page?: number;
  page_size?: number;
  /** `true` | `false` | bỏ trống = tất cả */
  active?: boolean;
}

// ---------- Xác thực ----------
export type Role = 'admin' | 'ketoan';

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
}

export interface UserBody {
  username: string;
  /** Khi sửa: chuỗi rỗng = giữ nguyên mật khẩu. */
  password: string;
  full_name: string;
  role: Role;
  active: boolean;
}

// ---------- Danh mục ----------
export interface Warehouse {
  id: number;
  code: string;
  name: string;
  active: boolean;
}
export type WarehouseBody = Omit<Warehouse, 'id'>;

export interface ProductGroup {
  id: number;
  code: string;
  name: string;
  active: boolean;
}
export type ProductGroupBody = Omit<ProductGroup, 'id'>;

export interface Product {
  id: number;
  code: string;
  name: string;
  unit: string;
  group_id: number | null;
  group_code: string | null;
  group_name: string | null;
  sale_price: number;
  purchase_price: number;
  is_service: boolean;
  active: boolean;
}

export interface ProductBody {
  code: string;
  name: string;
  unit: string;
  group_id: number | null;
  sale_price: number;
  purchase_price: number;
  is_service: boolean;
  active: boolean;
}

export interface ProductListParams extends ListParams {
  group_id?: number;
  is_service?: boolean;
}

export type CostSource = 'last_purchase' | 'default' | 'none';

export interface StockByWarehouse {
  warehouse_id: number;
  code: string;
  name: string;
  qty: number;
}

export interface PriceInfo {
  product_id: number;
  code: string;
  name: string;
  unit: string;
  is_service: boolean;
  date: string;
  sale_price: number;
  purchase_price: number;
  cost_price: number;
  cost_source: CostSource;
  total_stock: number;
  stock_by_warehouse: StockByWarehouse[];
}

export interface Partner {
  id: number;
  code: string;
  name: string;
  address: string;
  phone: string;
  tax_code: string;
  is_customer: boolean;
  is_supplier: boolean;
  opening_receivable: number;
  opening_payable: number;
  active: boolean;
}
export type PartnerBody = Omit<Partner, 'id'>;
export type PartnerType = 'customer' | 'supplier';

export interface PartnerListParams extends ListParams {
  type?: PartnerType;
}

export type CashAccountKind = 'cash' | 'bank';

export interface CashAccount {
  id: number;
  code: string;
  name: string;
  kind: CashAccountKind;
  opening_balance: number;
  active: boolean;
}
export type CashAccountBody = Omit<CashAccount, 'id'>;

// ---------- Chứng từ (dùng từ giai đoạn 2) ----------
export type DocType = 'purchase' | 'sale_return' | 'sale' | 'purchase_return' | 'transfer' | 'opening';
export type DocStatus = 'draft' | 'posted';

export interface LossWarning {
  type: 'loss';
  line_no: number;
  product_id: number;
  product_code: string;
  product_name: string;
  unit_price: number;
  cost_price: number;
  cost_source: CostSource;
  message: string;
}

export interface Shortage {
  product_id: number;
  product_code: string;
  product_name: string;
  unit: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  date: string;
  available: number;
  required: number;
  shortage: number;
  balance: number;
  message: string;
}

export interface VersionConflictDetails {
  updated_by: string;
  updated_at: string;
  current_version: number;
}

export interface DocumentSummary {
  id: number;
  doc_type: DocType;
  doc_type_name: string;
  doc_no: string | null;
  draft_no: string;
  display_no: string;
  doc_date: string;
  status: DocStatus;
  partner_id: number | null;
  partner_name: string | null;
  warehouse_id: number;
  warehouse_name: string;
  to_warehouse_id: number | null;
  to_warehouse_name: string | null;
  note: string;
  total_amount: number;
  line_count: number;
  version: number;
  created_by_name: string;
  updated_by_name: string;
  posted_at: string | null;
  updated_at: string;
}

// ---------- Tổng quan ----------
export interface RecentDraft {
  document_id: number;
  doc_type: DocType;
  draft_no: string;
  doc_date: string;
  partner_name: string | null;
  total_amount: number;
  updated_by_name: string;
  updated_at: string;
}

export interface Dashboard {
  today: string;
  draft_count: number;
  draft_sale_count: number;
  revenue_today: number;
  revenue_month: number;
  total_receivable: number;
  total_payable: number;
  low_stock_count: number;
  out_of_stock_count: number;
  low_stock_threshold: number;
  cash_balance: number;
  bank_balance: number;
  draft_shortage_count: number;
  recent_drafts: RecentDraft[];
  generated_at: string;
}

// ---------- Báo cáo dùng ở giai đoạn 1 ----------
export interface StockSummaryItem {
  product_id: number;
  code: string;
  name: string;
  unit: string;
  group_id: number | null;
  group_name: string | null;
  by_warehouse: Record<string, number>;
  total: number;
}

export interface StockSummary {
  as_of: string;
  warehouses: { id: number; code: string; name: string }[];
  items: StockSummaryItem[];
  totals_by_warehouse: Record<string, number>;
  total_qty: number;
}

// ---------- Sự kiện thời gian thực (SSE) ----------
export type CatalogEntity = 'warehouse' | 'product_group' | 'product' | 'partner' | 'cash_account' | 'user' | 'settings';
export type ChangeAction = 'created' | 'updated' | 'posted' | 'unposted' | 'deleted';

interface ServerEventBase {
  id: number;
  action: ChangeAction;
  by: string;
  by_id: number;
  at: string;
}

export interface DocumentChangedEvent extends ServerEventBase {
  type: 'document.changed';
  doc_type: DocType;
  status: DocStatus;
}

export interface VoucherChangedEvent extends ServerEventBase {
  type: 'voucher.changed';
  doc_type: 'receipt' | 'payment';
}

export interface CatalogChangedEvent extends ServerEventBase {
  type: 'catalog.changed';
  entity: CatalogEntity;
}

export type ServerEvent = DocumentChangedEvent | VoucherChangedEvent | CatalogChangedEvent;

// ---------- Chứng từ kho: chi tiết ----------
export interface DocumentLine {
  id: number;
  line_no: number;
  product_id: number;
  product_code: string;
  product_name: string;
  is_service: boolean;
  description: string;
  unit: string;
  qty: number;
  unit_price: number | null;
  amount: number;
  note: string;
}

export interface DocumentFull {
  id: number;
  doc_type: DocType;
  doc_type_name: string;
  doc_no: string | null;
  draft_no: string;
  display_no: string;
  doc_date: string;
  status: DocStatus;
  partner_id: number | null;
  partner_code: string | null;
  partner_name: string | null;
  partner_address: string | null;
  partner_phone: string | null;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  to_warehouse_id: number | null;
  to_warehouse_code: string | null;
  to_warehouse_name: string | null;
  note: string;
  total_amount: number;
  version: number;
  created_by: number;
  created_by_name: string;
  updated_by: number;
  updated_by_name: string;
  posted_by: number | null;
  posted_by_name: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
  lines: DocumentLine[];
  warnings: LossWarning[];
  old_debt: number | null;
  total_debt: number | null;
}

export interface DocumentLineBody {
  product_id: number;
  description: string;
  unit: string;
  qty: number | null;
  unit_price: number | null;
  note: string;
}

export interface DocumentBody {
  doc_type: DocType;
  doc_date: string;
  partner_id: number | null;
  warehouse_id: number | null;
  to_warehouse_id: number | null;
  note: string;
  lines: DocumentLineBody[];
  version?: number;
  confirm_loss?: boolean;
}

export interface DocumentListParams {
  type?: string;
  status?: DocStatus;
  partner_id?: number;
  warehouse_id?: number;
  product_id?: number;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  page_size?: number;
}

export interface DocumentCheck {
  stock_shortages: Shortage[];
  loss_lines: LossWarning[];
  can_post: boolean;
}

export type HistoryAction = 'created' | 'updated' | 'posted' | 'unposted' | 'deleted';

export interface DocumentHistoryEntry {
  id: number;
  at: string;
  user_id: number;
  user_name: string;
  action: HistoryAction;
  before: DocumentFull | null;
  after: DocumentFull | null;
}

// ---------- Giai đoạn 3: báo cáo, cài đặt ----------
export type ProductWithStock = Product & { total_stock?: number; warehouse_qty?: number };
export type PriceInfoWh = PriceInfo & { warehouse_qty?: number };

export interface DocumentPage extends Paged<DocumentSummary> {
  sum_total_amount: number;
}

export interface Settings {
  company_name: string;
  company_address: string;
  company_phone: string;
  company_tax_code: string;
  updated_by_name?: string;
  updated_at?: string;
}

export interface StockNxtItem {
  product_id: number;
  code: string;
  name: string;
  unit: string;
  group_name: string | null;
  opening: number;
  qty_in: number;
  qty_out: number;
  closing: number;
}
export interface StockNxt {
  from: string;
  to: string;
  warehouse_id: number | null;
  items: StockNxtItem[];
  totals: { opening: number; qty_in: number; qty_out: number; closing: number };
}

export interface StockLedgerRow {
  date: string;
  doc_no: string;
  document_id: number;
  doc_type: DocType;
  description: string;
  partner_id: number | null;
  partner_name: string | null;
  warehouse_id: number;
  warehouse_code: string;
  product_code: string;
  unit: string;
  qty_in: number;
  qty_out: number;
  balance: number;
  unit_price: number | null;
}
export interface StockLedger {
  product: { id: number; code: string; name: string; unit: string };
  from: string | null;
  to: string | null;
  warehouse_id: number | null;
  opening: number;
  rows: StockLedgerRow[];
  total_in: number;
  total_out: number;
  closing: number;
}

export interface TradeRow {
  date: string;
  doc_no: string;
  document_id: number;
  doc_type: DocType;
  partner_id: number;
  partner_code: string;
  partner_name: string;
  warehouse_id: number;
  warehouse_name: string;
  line_no: number;
  product_id: number;
  product_code: string;
  product_name: string;
  is_service: boolean;
  description: string;
  unit: string;
  qty: number;
  unit_price: number | null;
  amount: number;
}
export interface TradeReport {
  kind: 'sales' | 'purchases';
  from: string;
  to: string;
  rows: TradeRow[];
  total_qty: number;
  total_amount: number;
  document_count: number;
}

export interface DraftDemandItem {
  product_id: number;
  product_code: string;
  product_name: string;
  unit: string;
  qty_in_drafts: number;
  total_stock: number;
  shortage: number;
  drafts: { document_id: number; draft_no: string; doc_date: string; partner_id: number | null; partner_name: string | null; qty: number }[];
}
