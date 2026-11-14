// Dữ liệu dùng chung giữa các câu chuyện (mã, tên theo đúng tài liệu của khách khi có).
const USERS = {
  lan: { username: 'lan', full_name: 'Nguyễn Thị Lan (Máy 1)', password: 'lan123456' },
  hoa: { username: 'hoa', full_name: 'Trần Thị Hoa (Máy 2)', password: 'hoa123456' },
};

const COMPANY = {
  name: 'CÔNG TY TNHH VẬT TƯ HÀN MINH PHÁT',
  address: '12 Lê Trọng Tấn, P. Tây Thạnh, Q. Tân Phú, TP.HCM',
  phone: '028 3812 3456',
  tax: '0312345678',
};

const GROUPS = [
  { code: 'QH', name: 'Que hàn' },
  { code: 'DH', name: 'Dây hàn' },
  { code: 'BEC', name: 'Béc – bép hàn' },
  { code: 'PK', name: 'Phụ kiện hàn' },
];

// Mặt hàng trong ví dụ phiếu bán của khách
const SLIP_PRODUCTS = [
  { code: '4CA200A5', name: 'Súng hàn CO2 200A-5.0M (EU)', unit: 'Bộ', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 600000, purchase_price: 450000 },
  { code: 'CN249SS08', name: 'Béc CO2 Sunshine 0.8 mm', unit: 'Cái', group_code: 'BEC', group_name: 'Béc – bép hàn', sale_price: 13000, purchase_price: 9000 },
  { code: 'CN249SS10', name: 'Béc CO2 Sunshine 1.0 mm', unit: 'Cái', group_code: 'BEC', group_name: 'Béc – bép hàn', sale_price: 13000, purchase_price: 9000 },
  { code: 'COS10', name: 'Đầu cos (khoen đồng) 10mm (50c/bao)', unit: 'Cái', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 6000, purchase_price: 4000 },
  { code: 'K701832', name: 'Que hàn Kiswel K7018-3.2 (20kg)', unit: 'Thùng', group_code: 'QH', group_name: 'Que hàn', sale_price: 1090000, purchase_price: 950000 },
];

const THANHCONG = { code: 'THANHCONG', name: 'Xưởng cơ khí Thành Công', address: '45 Tân Kỳ Tân Quý, Bình Tân', phone: '0909 444 555', is_customer: true, opening_receivable: 2000000 };
const DAIPHAT = { code: 'DAIPHAT', name: 'Công ty CP Kết cấu thép Đại Phát', address: 'KCN Tân Tạo, Bình Tân', phone: '0283 765 4321', is_customer: true, opening_receivable: 5000000 };
const SUNSHINE = { code: 'SUNSHINE', name: 'Công ty TNHH Sunshine Welding', address: 'KCN Sóng Thần, Bình Dương', phone: '0274 3333 888', is_supplier: true, opening_payable: 10000000 };
const KISWEL = { code: 'KISWEL', name: 'Công ty TNHH Kiswel Việt Nam', address: 'KCN Nhơn Trạch, Đồng Nai', phone: '0251 3569 000', is_supplier: true, opening_payable: 0 };

module.exports = { USERS, COMPANY, GROUPS, SLIP_PRODUCTS, THANHCONG, DAIPHAT, SUNSHINE, KISWEL };
