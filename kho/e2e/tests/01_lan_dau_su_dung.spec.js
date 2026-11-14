// Câu chuyện 1 — Lần đầu dùng phần mềm trên hệ thống trống (theo "Bắt đầu dùng lần đầu" trong HUONG_DAN_SU_DUNG.md).
// Toàn bộ qua giao diện: thông tin công ty, 2 kế toán, nhóm hàng, mặt hàng, khách hàng, NCC (kèm nợ đầu kỳ),
// tồn đầu kỳ ở cả 4 kho; rồi đọc lại trên màn Tồn kho, Công nợ và Tổng quan.
const { test, expect } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { USERS, COMPANY, GROUPS, SLIP_PRODUCTS, THANHCONG, DAIPHAT, SUNSHINE, KISWEL } = require('../lib/data');

test.describe.configure({ mode: 'serial' });

const OPENING = [
  { wh: 'KHO1', lines: [{ code: 'K701832', qty: 10 }, { code: '4CA200A5', qty: 3 }] },
  { wh: 'KHO2', lines: [{ code: 'CN249SS08', qty: 200 }, { code: 'CN249SS10', qty: 150 }] },
  { wh: 'KHO3', lines: [{ code: 'COS10', qty: 500 }, { code: '4CA200A5', qty: 5 }] },
  { wh: 'KHO4', lines: [{ code: 'K701832', qty: 6 }, { code: 'COS10', qty: 100 }] },
];

test.describe('Câu chuyện 1: lần đầu sử dụng', () => {
  /** @type {import('@playwright/test').Page} */
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    require('../lib/fixtures').monitor(page, 'admin');
  });
  test.afterAll(async () => page.close());

  test('REQ-090 Màn đăng nhập và trang Tổng quan có hướng dẫn bắt đầu', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Quản lý Kho – Bán hàng' })).toBeVisible();
    await ui.shot(page, '01-dang-nhap');
    // sai mật khẩu ⇒ thông báo tiếng Việt
    await page.getByLabel('Tên đăng nhập').fill('admin');
    await page.getByLabel('Mật khẩu').fill('sai-mat-khau');
    await page.getByLabel('Mật khẩu').press('Enter');
    await expect(page.getByText('Sai tên đăng nhập hoặc mật khẩu')).toBeVisible();
    await ui.login(page, 'admin', 'admin123');
    await expect(page.getByText('Bắt đầu sử dụng — làm lần lượt các bước sau')).toBeVisible();
    await ui.shot(page, '01-tong-quan-trong');
  });

  test('REQ-090 Nhập thông tin công ty (Hệ thống › Thông tin công ty), Ctrl+S lưu', async () => {
    await ui.menu(page, 'Hệ thống', 'Thông tin công ty');
    // trang tự đặt con trỏ vào ô đầu sau khi nạp dữ liệu — chờ như người dùng thấy con trỏ
    await expect(page.getByLabel('Tên công ty')).toBeFocused();
    await page.getByLabel('Tên công ty').fill(COMPANY.name);
    await page.getByLabel('Địa chỉ').fill(COMPANY.address);
    await page.getByLabel('Điện thoại').fill(COMPANY.phone);
    await page.getByLabel('Mã số thuế').fill(COMPANY.tax);
    await page.keyboard.press('Control+s');
    await ui.toast(page, /Đã lưu/);
    await page.reload();
    await expect(page.getByLabel('Tên công ty')).toBeFocused();
    await expect(page.getByLabel('Tên công ty')).toHaveValue(COMPANY.name);
    await expect(page.getByLabel('Địa chỉ')).toHaveValue(COMPANY.address);
    await expect(page.getByLabel('Mã số thuế')).toHaveValue(COMPANY.tax);
  });

  test('REQ-042 Tạo hai người dùng kế toán (Máy 1, Máy 2) bằng F2', async () => {
    await ui.menu(page, 'Hệ thống', 'Người dùng');
    for (const u of [USERS.lan, USERS.hoa]) {
      await expect(page.getByRole('heading', { name: /Người dùng/ })).toBeVisible();
      await page.locator('body').press('F2');
      const dlg = page.getByRole('dialog', { name: 'Thêm người dùng' });
      await expect(dlg).toBeVisible();
      await dlg.getByLabel('Tên đăng nhập').fill(u.username);
      await dlg.getByLabel('Họ tên').fill(u.full_name);
      await dlg.getByLabel('Mật khẩu').fill(u.password);
      await dlg.getByRole('button', { name: 'Lưu' }).click();
      await expect(dlg).toBeHidden();
      await expect(page.getByRole('row', { name: new RegExp(u.username) })).toContainText('Kế toán');
    }
  });

  test('REQ-020 Nhóm hàng (nhóm VTHH)', async () => {
    await ui.menu(page, 'Danh mục', 'Nhóm hàng');
    for (const g of GROUPS) {
      await page.getByRole('button', { name: /Thêm/ }).click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Mã').fill(g.code);
      await dlg.getByLabel(/Tên nhóm/).fill(g.name);
      await page.keyboard.press('Control+s');
      await expect(dlg).toBeHidden();
    }
    for (const g of GROUPS) await expect(page.getByRole('cell', { name: g.name, exact: true })).toBeVisible();
  });

  test('REQ-026 Danh mục hàng hóa: mã, tên, ĐVT, nhóm, giá bán, giá mua', async () => {
    await ui.menu(page, 'Danh mục', 'Hàng hóa, dịch vụ');
    await expect(page.getByRole('heading', { name: /Hàng hóa, dịch vụ/ })).toBeVisible();
    for (const p of SLIP_PRODUCTS) {
      await page.locator('body').press('F2');
      const dlg = page.getByRole('dialog', { name: 'Thêm mặt hàng' });
      await expect(dlg.getByLabel('Mã hàng')).toBeFocused();
      await dlg.getByLabel('Mã hàng').fill(p.code);
      await dlg.getByLabel('Tên hàng').fill(p.name);
      await dlg.getByLabel('Đơn vị tính').fill(p.unit);
      await dlg.getByLabel('Đơn vị tính').press('Escape'); // đóng gợi ý ĐVT
      // ứng dụng đóng danh sách gợi ý rồi đặt lại con trỏ vào ô ĐVT — chờ như người dùng thấy rồi mới sang ô khác
      await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).toHaveCount(0);
      await expect(dlg.getByLabel('Đơn vị tính')).toBeFocused();
      await ui.selectByTyping(page, dlg.getByLabel('Nhóm hàng'), p.group_code, new RegExp(`^${p.group_code} –`));
      await dlg.getByLabel('Giá bán').fill(String(p.sale_price));
      await dlg.getByLabel('Giá mua').fill(String(p.purchase_price));
      await dlg.getByRole('button', { name: 'Lưu' }).click();
      await expect(dlg).toBeHidden();
    }
    // đọc lại danh sách: đúng tên, ĐVT, nhóm cho từng mã; giá hiển thị đúng định dạng VN
    for (const p of SLIP_PRODUCTS) {
      const cells = (await page.getByRole('row', { name: new RegExp(p.code) }).locator('td').allInnerTexts()).map((t) => t.trim());
      expect(cells.slice(0, 4), p.code).toEqual([p.code, expect.stringContaining(p.name), p.unit, p.group_name]);
    }
    const row = page.getByRole('row', { name: /K701832/ });
    await expect(row).toContainText('Que hàn Kiswel K7018-3.2 (20kg)');
    await expect(row).toContainText('1.090.000');
    await expect(row).toContainText('950.000');
    await expect(row).toContainText('Thùng');
    // tìm không dấu
    await page.getByPlaceholder(/Tìm mã, tên hàng/).fill('dau cos');
    await expect(page.getByRole('row', { name: /COS10/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /K701832/ })).toHaveCount(0);
    await ui.shot(page, '01-danh-muc-hang-hoa');
  });

  test('REQ-052 REQ-054 Khách hàng và nhà cung cấp, có nợ đầu kỳ', async () => {
    await ui.menu(page, 'Danh mục', 'Khách hàng');
    for (const c of [THANHCONG, DAIPHAT]) {
      await expect(page.getByRole('heading', { name: /Khách hàng/ })).toBeVisible();
      await page.locator('body').press('F2');
      const dlg = page.getByRole('dialog', { name: 'Thêm khách hàng' });
      await dlg.getByLabel(/^Mã\s*\*?$/).fill(c.code);
      await dlg.getByLabel(/^Tên\s*\*?$/).fill(c.name);
      await dlg.getByLabel('Địa chỉ').fill(c.address);
      await dlg.locator('#phone').fill(c.phone);
      await expect(dlg.getByRole('checkbox', { name: 'Khách hàng' })).toBeChecked();
      await dlg.getByLabel('Nợ phải thu đầu kỳ').fill(String(c.opening_receivable));
      await page.keyboard.press('Control+s');
      await expect(dlg).toBeHidden();
    }
    await expect(page.getByRole('row', { name: /DAIPHAT/ })).toContainText('5.000.000');

    await ui.menu(page, 'Danh mục', 'Nhà cung cấp');
    for (const s of [SUNSHINE, KISWEL]) {
      await expect(page.getByRole('heading', { name: /Nhà cung cấp/ })).toBeVisible();
      await page.locator('body').press('F2');
      const dlg = page.getByRole('dialog', { name: 'Thêm nhà cung cấp' });
      await dlg.getByLabel(/^Mã\s*\*?$/).fill(s.code);
      await dlg.getByLabel(/^Tên\s*\*?$/).fill(s.name);
      await dlg.getByLabel('Địa chỉ').fill(s.address);
      await expect(dlg.getByRole('checkbox', { name: 'Nhà cung cấp' })).toBeChecked();
      await dlg.getByLabel('Nợ phải trả đầu kỳ').fill(String(s.opening_payable));
      await dlg.getByRole('button', { name: 'Lưu' }).click();
      await expect(dlg).toBeHidden();
    }
    await expect(page.getByRole('row', { name: /SUNSHINE/ })).toContainText('10.000.000');
  });

  test('REQ-007 Tài khoản tiền: số dư đầu kỳ quỹ tiền mặt (TM) và ngân hàng (NH) (nhấp đúp để sửa)', async () => {
    await ui.menu(page, 'Danh mục', 'Tài khoản tiền');
    for (const [code, amount] of [['TM', '50.000.000'], ['NH', '200.000.000']]) {
      await page.getByRole('row', { name: new RegExp(`^${code} `) }).dblclick();
      const dlg = page.getByRole('dialog', { name: `Sửa tài khoản tiền ${code}` });
      await dlg.getByLabel('Số dư đầu kỳ').fill(amount);
      await page.keyboard.press('Control+s');
      await expect(dlg).toBeHidden();
      await expect(page.getByRole('row', { name: new RegExp(`^${code} `) })).toContainText(amount);
    }
  });

  test('REQ-013 REQ-076 Tồn đầu kỳ ở cả 4 kho (Kho › Tồn đầu kỳ, F2, F9 ghi sổ)', async () => {
    for (const o of OPENING) {
      await ui.menu(page, 'Kho', 'Tồn đầu kỳ');
      await ui.newDocByF2(page, /Tồn đầu kỳ/);
      await expect(page.getByRole('heading', { name: 'Phiếu nhập tồn đầu kỳ' })).toBeVisible();
      await ui.setDocDate(page, '01/01/2026');
      await ui.pickWarehouse(page, o.wh);
      await ui.focusBlankCode(page);
      for (const l of o.lines) await ui.typeLine(page, { code: l.code, qty: l.qty });
      const no = await ui.postDoc(page);
      expect(no).toMatch(/^TDK\d{5}$/);
    }
    await ui.shot(page, '01-phieu-ton-dau-ky');
  });

  test('REQ-009 REQ-010 REQ-013 Màn Tồn kho hiện đúng tồn từng kho và tổng sau tồn đầu kỳ', async () => {
    await ui.menu(page, 'Kho', 'Tồn kho');
    const r = await ui.readReport(page, { waitFor: 'K701832' });
    const by = Object.fromEntries(r.obj.map((x) => [x['Mã hàng'], x]));
    const expectRow = (code, k1, k2, k3, k4) => {
      expect(by[code], `dòng ${code}`).toBeTruthy();
      expect([by[code].KHO1, by[code].KHO2, by[code].KHO3, by[code].KHO4, by[code]['Tổng tồn']].map(ui.vnNum)).toEqual([k1, k2, k3, k4, k1 + k2 + k3 + k4]);
    };
    expectRow('K701832', 10, 0, 0, 6);
    expectRow('4CA200A5', 3, 0, 5, 0);
    expectRow('CN249SS08', 0, 200, 0, 0);
    expectRow('CN249SS10', 0, 150, 0, 0);
    expectRow('COS10', 0, 0, 500, 100);
    expect(r.obj.find((x) => x['Mã hàng'] === 'DV')).toBeUndefined();
    await ui.shot(page, '01-ton-kho-4-kho');
  });

  test('REQ-052 REQ-054 Công nợ đầu kỳ hiện ở Phải thu / Phải trả', async () => {
    await ui.menu(page, 'Công nợ', 'Phải thu khách hàng');
    await expect(page.getByRole('heading', { name: 'Công nợ phải thu khách hàng' })).toBeVisible();
    let r = await ui.readReport(page, { waitFor: 'DAIPHAT' });
    const dp = r.obj.find((x) => x['Mã'] === 'DAIPHAT');
    expect(ui.vnNum(dp['Đầu kỳ'])).toBe(5000000);
    expect(ui.vnNum(dp['Khách còn nợ'])).toBe(5000000);
    await ui.menu(page, 'Công nợ', 'Phải trả nhà cung cấp');
    await expect(page.getByRole('heading', { name: 'Công nợ phải trả nhà cung cấp' })).toBeVisible();
    r = await ui.readReport(page, { waitFor: 'SUNSHINE' });
    const ss = r.obj.find((x) => x['Mã'] === 'SUNSHINE');
    expect(ui.vnNum(ss['Mình còn nợ'])).toBe(10000000);
  });

  test('REQ-042 Kế toán mới đăng nhập được, không thấy menu Hệ thống', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    require('../lib/fixtures').monitor(p2, 'lan');
    await ui.login(p2, USERS.lan.username, USERS.lan.password);
    await expect(p2.getByRole('button', { name: 'Tài khoản', exact: true })).toContainText(USERS.lan.full_name.split(' (')[0]);
    await expect(p2.getByRole('menuitem', { name: /Hệ thống/ })).toHaveCount(0);
    // tổng quan: phải thu / phải trả đầu kỳ đã tính
    await expect(p2.getByRole('button', { name: /Khách hàng còn nợ/ })).toContainText('7.000.000');
    await expect(p2.getByRole('button', { name: /Còn nợ nhà cung cấp/ })).toContainText('10.000.000');
    await ui.shot(p2, '01-tong-quan-ke-toan');
    await ctx.close();
    // đối chiếu API: tồn tổng
    const api = await Api.login();
    const s = await api.stockSummary({ as_of: '2026-01-01' });
    expect(s.total_qty).toBe(10 + 3 + 200 + 150 + 500 + 5 + 6 + 100);
  });
});
