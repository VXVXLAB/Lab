// Câu chuyện 14 — Dùng bàn phím và độ bền chung: các phím tắt ghi trên màn hình/hướng dẫn thực sự chạy; chặn rời
// trang khi chưa lưu; phiên hết hạn ⇒ về màn đăng nhập; không cuộn ngang ở 1366×768; không còn chữ tiếng Anh hay mã lỗi
// thô trên các màn chính. (Lỗi console / 5xx của TOÀN BỘ lần chạy được kiểm ở tests/99_*.)
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { THANHCONG, SLIP_PRODUCTS } = require('../lib/data');

test.describe.configure({ mode: 'serial' });

const QUE = { code: 'KT32-5', name: 'Que hàn Kim Tín KT-421 3.2mm (5kg)', unit: 'Hộp', group_code: 'QH', group_name: 'Que hàn', sale_price: 180000, purchase_price: 146000 };

test.describe('Câu chuyện 14: bàn phím, chặn rời trang, phiên hết hạn, giao diện', () => {
  let page;
  let ctx;
  let api;
  test.beforeAll(async ({ browser }) => {
    api = await Api.login();
    await api.ensurePartner(THANHCONG);
    await api.ensurePartner({ code: 'ANBINH', name: 'Công ty TNHH An Bình', is_customer: true });
    await api.ensurePartner({ code: 'ANPHU', name: 'Cơ khí An Phú', is_customer: true });
    await api.ensurePartner({ code: 'TANTHANH', name: 'Công ty TNHH Thép Tân Thành', is_supplier: true });
    await api.ensureProduct(QUE);
    for (const p of SLIP_PRODUCTS) await api.ensureProduct(p);
    await api.openingStock('KHO1', '2026-01-01', [{ product_code: QUE.code, qty: 40 }, { product_code: 'CN249SS08', qty: 10 }, { product_code: 'COS10', qty: 10 }]);
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    ({ ctx, page } = await openAs(browser, 'lan', 'lan123456', 'lan'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-UX Danh mục: "/" và F3 vào ô tìm, ↓ chọn dòng, Enter mở sửa, Esc đóng, Delete hỏi trước khi xóa', async () => {
    await ui.menu(page, 'Danh mục', 'Khách hàng');
    await expect(page.locator('main')).toContainText(/F2\s*thêm mới · F3\s*\/\s*\/\s*tìm/);
    await ui.blurAll(page);
    await page.keyboard.press('/');
    const search = page.getByPlaceholder(/Tìm/);
    await expect(search).toBeFocused();
    await page.keyboard.type('thanh cong');
    // chờ danh sách lọc xong (chỉ còn 1 khách) rồi mới chọn dòng
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(1);
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toContainText('THANHCONG');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Sửa khách hàng THANHCONG' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel(/^Mã\s*\*?$/)).toBeFocused(); // con trỏ đã vào ô đầu
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    // đóng hộp thoại xong con trỏ trở lại danh sách, dòng vẫn đang chọn
    await expect(page.getByLabel('Danh sách khách hàng')).toBeFocused();
    await page.keyboard.press('Delete');
    const conf = page.locator('.ant-modal-confirm').filter({ hasText: 'Xóa khách hàng này?' });
    await expect(conf).toBeVisible();
    // nút mặc định (đang có con trỏ) là nút an toàn "Không xóa"
    await expect(conf.getByRole('button', { name: 'Không xóa' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(conf).toBeHidden();
    await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(1);
    await ui.blurAll(page);
    await page.keyboard.press('F3');
    await expect(search).toBeFocused();
  });

  test('REQ-UX Trong phiếu: F4 thêm khách mới ngay tại chỗ (tên đã gõ điền sẵn), khách mới được chọn vào phiếu', async () => {
    await ui.menu(page, 'Bán hàng', 'Phiếu bán');
    await ui.newDocByF2(page, /^Phiếu bán hàng/);
    await expect(page.locator('#partner')).toBeFocused();
    await page.keyboard.type('Anh Tư sửa xe', { delay: 15 });
    await expect(page.getByText('Không thấy khách hàng nào.')).toBeVisible();
    await page.keyboard.press('F4');
    const dlg = page.getByRole('dialog', { name: 'Thêm khách hàng' });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel(/^Tên\s*\*?$/)).toHaveValue('Anh Tư sửa xe');
    await dlg.getByLabel(/^Mã\s*\*?$/).fill('ANHTU');
    await dlg.locator('#phone').fill('0977 123 456');
    await page.keyboard.press('Control+s');
    await expect(dlg).toBeHidden();
    await expect(page.locator('.hf-partner .ant-select-selection-item')).toContainText('ANHTU – Anh Tư sửa xe');
  });

  test('REQ-UX Gõ một phần tên "que 3.2" ở ô mã hàng → danh sách gợi ý → Enter lấy mã', async () => {
    await ui.pickWarehouse(page, 'KHO1');
    await ui.focusBlankCode(page);
    await page.keyboard.type('que 3.2', { delay: 15 });
    await page.keyboard.press('Enter');
    const dd = page.locator('.product-dropdown');
    await expect(dd).toBeVisible();
    await expect(dd.locator('tbody tr').filter({ hasText: QUE.code })).toBeVisible();
    await expect(dd).toContainText('↑↓ chọn · Enter lấy · Esc đóng');
    // đưa dòng sáng tới đúng mã rồi Enter
    for (let i = 0; i < 10 && !(await dd.locator('tbody tr.active').innerText()).includes(QUE.code); i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await ui.focused(page, '[data-cell$=":qty"]');
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await ui.typeLine(page, { code: 'CN249SS08', qty: 2 });
    await ui.typeLine(page, { code: 'COS10', qty: 1 });
    expect((await ui.readLines(page)).map((l) => l.code)).toEqual([QUE.code, 'CN249SS08', 'COS10']);
  });

  test('REQ-UX F6 thẻ kho và F7 lịch sử bán của dòng đang đứng; Esc đóng', async () => {
    await page.locator('.line-grid tbody tr').first().locator('input.code-input').click();
    await page.keyboard.press('F6');
    await expect(ui.topDrawer(page)).toContainText(`Thẻ kho — ${QUE.code}`);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
    await page.locator('.line-grid tbody tr').first().locator('input.code-input').click();
    await page.keyboard.press('F7');
    await expect(ui.topDrawer(page)).toContainText(`Lịch sử bán — ${QUE.code}`);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
  });

  test('REQ-UX Alt+↓ dời dòng, Ctrl+Insert chèn dòng, Ctrl+Delete xóa dòng', async () => {
    const codes = async () => (await ui.readLines(page)).map((l) => l.code);
    await page.locator('.line-grid tbody tr').first().locator('input.code-input').click();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(codes).toEqual(['CN249SS08', QUE.code, 'COS10']);
    await page.keyboard.press('Control+Insert');
    await expect(page.locator('.line-grid tbody tr.row-blank')).toHaveCount(2);
    await page.keyboard.type('4CA200A5');
    await page.keyboard.press('Enter');
    await ui.focused(page, '[data-cell$=":qty"]');
    await expect.poll(codes).toEqual(['CN249SS08', '4CA200A5', QUE.code, 'COS10']);
    await page.locator('.line-grid tbody tr').nth(1).locator('input.code-input').click();
    await page.keyboard.press('Control+Delete');
    await expect.poll(codes).toEqual(['CN249SS08', QUE.code, 'COS10']);
  });

  test('REQ-UX Chặn rời trang khi phiếu chưa lưu: "Ở lại phiếu" giữ nguyên dòng; "Bỏ thay đổi, rời đi" mới rời', async () => {
    const before = await ui.readLines(page);
    await ui.clickMenu(page, 'Kho', 'Tồn kho');
    let conf = page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
    await expect(conf).toBeVisible();
    await expect(conf).toContainText('Bạn có thay đổi chưa lưu');
    await ui.shot(page, '14-chan-roi-trang');
    await conf.getByRole('button', { name: 'Ở lại phiếu' }).click();
    await expect(page).toHaveURL(/\/chung-tu\/moi/);
    expect(await ui.readLines(page)).toEqual(before);
    // đóng tab / tải lại: trang chặn sự kiện beforeunload ⇒ trình duyệt hỏi "Rời khỏi trang?"
    const ev = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(ev).toBe(true);
    await ui.clickMenu(page, 'Kho', 'Tồn kho');
    conf = page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
    await conf.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
    await expect(page.getByRole('heading', { name: 'Tồn kho' })).toBeVisible();
  });

  test('REQ-UX Phiếu thu chưa lưu cũng được chặn rời trang', async () => {
    await ui.enterVoucher(page, { type: 'receipt', account: 'TM', partner: 'THANHCONG', partnerName: THANHCONG.name, lines: [{ desc: 'Thu nợ', amount: '100000' }], save: false });
    await ui.clickMenu(page, 'Quỹ & Ngân hàng', 'Chi tiền');
    const conf = page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
    await expect(conf).toBeVisible();
    await conf.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
    await expect(page.getByRole('heading', { name: /^Phiếu chi tiền/ })).toBeVisible();
  });

  test('REQ-UX Báo cáo dùng phím: ↓ chọn dòng, Enter mở chi tiết tại chỗ, Esc đóng', async () => {
    await ui.menu(page, 'Kho', 'Tồn kho');
    await ui.readReport(page, { waitFor: QUE.code });
    await page.locator('.report-table').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.report-table tr.row-active')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(ui.topDrawer(page)).toContainText('Thẻ kho —');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
  });

  test('REQ-UX Phiên hết hạn (quản trị đặt lại mật khẩu): thao tác kế tiếp đưa về màn đăng nhập có thông báo; đăng nhập lại làm tiếp', async ({ browser }) => {
    const { ctx: c2, page: p2 } = await openAs(browser, 'lan', 'lan123456', 'lan (phiên 2)');
    await ui.menu(p2, 'Bán hàng', 'Phiếu bán');
    const users = await api.get('/users');
    const lan = users.items.find((u) => u.username === 'lan');
    await api.put(`/users/${lan.id}`, { username: 'lan', full_name: lan.full_name, role: lan.role, active: true, password: 'lan123456' });
    await ui.menu(p2, 'Kho', 'Tồn kho').catch(() => undefined);
    await expect(p2.getByRole('heading', { name: 'Quản lý Kho – Bán hàng' })).toBeVisible();
    await expect(p2.getByText('Phiên làm việc đã hết. Vui lòng đăng nhập lại.')).toBeVisible();
    await ui.shot(p2, '14-phien-het-han');
    await p2.getByLabel('Tên đăng nhập').fill('lan');
    await p2.getByLabel('Mật khẩu').fill('lan123456');
    await p2.getByLabel('Mật khẩu').press('Enter');
    await expect(p2.getByRole('button', { name: 'Tài khoản', exact: true })).toBeVisible();
    await c2.close();
  });

  // ---------- F-04 (đã sửa, kiểm lại): phiếu gõ dở được giữ khi phiên bị ngắt ----------
  const killLan = async () => {
    const users = await api.get('/users');
    const lan = users.items.find((u) => u.username === 'lan');
    await api.put(`/users/${lan.id}`, { username: 'lan', full_name: lan.full_name, role: lan.role, active: true, password: 'lan123456' });
  };
  const reLogin = async (p, user, pass) => {
    await expect(p.getByText('Phiên làm việc đã hết. Vui lòng đăng nhập lại.')).toBeVisible();
    await p.getByLabel('Tên đăng nhập').fill(user);
    await p.getByLabel('Mật khẩu').fill(pass);
    await p.getByLabel('Mật khẩu').press('Enter');
    await expect(p.getByRole('button', { name: 'Tài khoản', exact: true })).toBeVisible();
  };
  const RESTORED = /Đã khôi phục các dòng đang gõ dở/;
  // Vòng 3 (F-14): phiên hết thật ⇒ đúng câu này (không phải câu "từ lần mở trước" dành cho tải lại trang)
  const SESSION_RESTORED = 'Phiên đăng nhập đã hết. Đã khôi phục các dòng đang gõ dở — kiểm tra rồi bấm Lưu.';
  let w4; // cửa sổ của lan dùng cho các bước F-04
  let draftUrl;

  test('REQ-UX F-04: phiên hết hạn lúc đang gõ phiếu bán ⇒ đăng nhập lại ĐÚNG người đó: khách, ghi chú, các dòng được khôi phục, có thông báo', async ({ browser }) => {
    w4 = await openAs(browser, 'lan', 'lan123456', 'lan (F-04)');
    const p = w4.page;
    await ui.enterDoc(p, { type: 'sale', partner: 'THANHCONG', partnerName: THANHCONG.name, wh: 'KHO1', note: 'Khách gọi đặt thêm', lines: [{ code: QUE.code, qty: 2 }, { code: 'COS10', qty: 1 }], action: 'none' });
    await killLan();
    await p.keyboard.press('Control+s');
    await reLogin(p, 'lan', 'lan123456');
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveText(SESSION_RESTORED);
    await expect.poll(async () => (await ui.readLines(p)).map((l) => `${l.code}:${ui.vnNum(l.qty)}`)).toEqual([`${QUE.code}:2`, 'COS10:1']);
    await expect(p.locator('.hf-partner .ant-select-selection-item')).toContainText(THANHCONG.name);
    await expect(p.getByLabel('Ghi chú', { exact: true })).toHaveValue('Khách gọi đặt thêm');
    await ui.shot(p, 'F04-khoi-phuc-dong-go-do');
    // lưu được bình thường
    const tam = await ui.saveDraft(p);
    const d = await api.docByNo(tam);
    expect(d.lines.map((l) => `${l.product_code}:${l.qty}`)).toEqual([`${QUE.code}:2`, 'COS10:1']);
  });

  test('REQ-UX F-04: đã lưu xong thì phiên ngắt lần nữa ⇒ không còn gì để khôi phục (không thông báo, không lặp dòng)', async () => {
    const p = w4.page;
    draftUrl = p.url();
    await killLan();
    await ui.clickMenu(p, 'Kho', 'Tồn kho');
    await reLogin(p, 'lan', 'lan123456');
    await p.goto(draftUrl);
    await expect(p.getByText('PHIẾU TẠM — chưa ghi sổ', { exact: true })).toBeVisible();
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveCount(0);
    expect((await ui.readLines(p)).map((l) => l.code)).toEqual([QUE.code, 'COS10']);
    await expect(p.getByText('Có thay đổi chưa lưu')).toHaveCount(0);
  });

  test('REQ-UX F-04: khôi phục rồi "Bỏ thay đổi, rời đi" ⇒ phiên ngắt lần sau không khôi phục lại phần đã bỏ', async () => {
    const p = w4.page;
    await ui.focusBlankCode(p);
    await ui.typeLine(p, { code: 'CN249SS08', qty: 3 });
    await killLan();
    await p.keyboard.press('Control+s');
    await reLogin(p, 'lan', 'lan123456');
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveText(SESSION_RESTORED);
    await expect.poll(async () => (await ui.readLines(p)).map((l) => l.code)).toEqual([QUE.code, 'COS10', 'CN249SS08']);
    // người dùng quyết định bỏ phần gõ thêm
    await ui.clickMenu(p, 'Bán hàng', 'Phiếu bán');
    await p.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' }).getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
    await expect(p.getByRole('heading', { name: /^Phiếu bán hàng/ })).toBeVisible();
    await killLan();
    await ui.clickMenu(p, 'Kho', 'Tồn kho');
    await reLogin(p, 'lan', 'lan123456');
    await p.goto(draftUrl);
    await expect(p.getByText('PHIẾU TẠM — chưa ghi sổ', { exact: true })).toBeVisible();
    expect((await ui.readLines(p)).map((l) => l.code)).toEqual([QUE.code, 'COS10']);
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveCount(0);
  });

  test('REQ-UX F-04: phiên của lan bị ngắt, người KHÁC (hoa) đăng nhập trên cùng cửa sổ ⇒ không thấy phiếu gõ dở của lan', async () => {
    const p = w4.page;
    await ui.enterDoc(p, { type: 'sale', partner: 'THANHCONG', partnerName: THANHCONG.name, wh: 'KHO1', note: 'Phiếu riêng của Lan', lines: [{ code: QUE.code, qty: 7 }], action: 'none' });
    const url = p.url();
    await killLan();
    await p.keyboard.press('Control+s');
    await reLogin(p, 'hoa', 'hoa123456');
    await expect(p.getByRole('button', { name: 'Tài khoản', exact: true })).toContainText('Trần Thị Hoa');
    await p.goto(url);
    await expect(p.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveCount(0);
    expect(await ui.readLines(p)).toEqual([]);
    await expect(p.getByLabel('Ghi chú', { exact: true })).toHaveValue('');
    // F-19 (vòng 3, chập chờn: phiếu mới TRỐNG của hoa hiện "Đã khôi phục…" và "Có thay đổi chưa lưu") — báo đã sửa ở vòng 4;
    // kiểm thẳng ở đây và lặp nhiều lần ở test F-19 bên dưới. Kiểm thẳng ở đây (sau khi kho mặc định đã điền) để lỗi tự nói rõ.
    await expect(p.locator('#warehouse').locator('xpath=ancestor::div[contains(@class,"ant-select")][1]')).toContainText('Kho');
    await p.waitForTimeout(500); // để mọi giá trị tự điền chạy xong rồi mới đọc
    if (await p.getByText('Có thay đổi chưa lưu').count()) await ui.shot(p, 'F19-phieu-trong-bao-chua-luu');
    // (khi lỗi xảy ra, hoa còn thấy "Đã khôi phục các dòng đang gõ dở từ lần mở trước" trên phiếu trống)
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveCount(0);
    await expect(p.getByText('Có thay đổi chưa lưu')).toHaveCount(0);
    // phiếu thu mới của hoa cũng trống
    await ui.menu(p, 'Quỹ & Ngân hàng', 'Thu tiền').catch(async (e) => {
      await ui.shot(p, 'loi-F04-hoa-khong-roi-phieu'); // ảnh chẩn đoán của chính cửa sổ này
      throw e;
    });
    await p.locator('body').press('F2');
    await expect(p.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveCount(0);
  });

  test('REQ-UX F-04: phiếu thu đang gõ cũng được khôi phục cho đúng người; đăng xuất chủ động thì bỏ', async ({ browser }) => {
    const { ctx: c5, page: p } = await openAs(browser, 'lan', 'lan123456', 'lan (F-04 phiếu thu)');
    await ui.enterVoucher(p, { type: 'receipt', account: 'TM', date: '18/10/2026', partner: 'THANHCONG', partnerName: THANHCONG.name, note: 'Thu nợ', lines: [{ desc: 'Thu nợ cũ', amount: '300000' }], save: false });
    await killLan();
    await p.keyboard.press('Control+s');
    await reLogin(p, 'lan', 'lan123456');
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveText(SESSION_RESTORED);
    await expect(p.locator('[data-vcell$=":desc"]').first()).toHaveValue('Thu nợ cũ');
    await expect(p.getByLabel('Số tiền dòng 1')).toHaveValue('300.000');
    await expect(p.getByLabel('Ghi chú / lý do')).toHaveValue('Thu nợ');
    // đăng xuất chủ động ⇒ bỏ
    await p.getByRole('button', { name: /Đăng xuất/ }).click();
    await p.locator('.ant-modal-confirm').getByRole('button', { name: 'Đăng xuất' }).click();
    await ui.login(p, 'lan', 'lan123456');
    await ui.menu(p, 'Quỹ & Ngân hàng', 'Thu tiền');
    await p.locator('body').press('F2');
    await expect(p.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
    await expect(p.locator('[data-vcell$=":desc"]').first()).toHaveValue('');
    await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toHaveCount(0);
    await c5.close();
    await w4.ctx.close();
  });

  // ---------- F-19 (vòng 3, chập chờn) — đã sửa ở vòng 4: phiếu chưa đụng tới KHÔNG được lưu bản gõ dở ----------
  // Bắt mọi lần ghi khóa "kho.unsaved.*" vào sessionStorage (kể cả ghi rồi xóa ngay trong một nhịp vẽ) bằng một móc cài
  // trước khi trang chạy, và đọc trực tiếp sessionStorage ở nhiều thời điểm trong giây đầu.
  const UNSAVED_HOOK = () => {
    const orig = Storage.prototype.setItem;
    window.__unsavedWrites = [];
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('kho.unsaved.')) window.__unsavedWrites.push(`${k} @${Math.round(performance.now())}ms`);
      return orig.call(this, k, v);
    };
  };
  const unsavedKeys = (p) => p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('kho.unsaved.')));
  /** Mở `open()`, đợi `ready`, rồi lấy mẫu sessionStorage ở 0/100/250/500/1000/1500 ms; trả các lần thấy khóa + các lần ghi. */
  async function sampleUntouched(p, open, ready) {
    await open();
    await expect(ready).toBeVisible();
    const seen = [];
    let t0 = Date.now();
    for (const at of [0, 100, 250, 500, 1000, 1500]) {
      const wait = at - (Date.now() - t0);
      if (wait > 0) await p.waitForTimeout(wait); // lấy mẫu theo mốc thời gian (yêu cầu kiểm "nhiều thời điểm trong giây đầu")
      const ks = await unsavedKeys(p);
      if (ks.length) seen.push(`${at}ms: ${ks.join(',')}`);
    }
    const writes = await p.evaluate(() => window.__unsavedWrites ?? []);
    const dirty = await p.getByText('Có thay đổi chưa lưu').count();
    return { seen, writes, dirty };
  }

  test('REQ-UX F-19 Mở phiếu/phiếu thu chi mới (cả loại điền sẵn) mà chưa gõ gì ⇒ sessionStorage KHÔNG có bản gõ dở ở bất kỳ thời điểm nào', async ({ browser }) => {
    const { ctx: c, page: p } = await openAs(browser, 'lan', 'lan123456', 'lan (F-19 chưa đụng)');
    await p.context().addInitScript(UNSAVED_HOOK);
    // dữ liệu cho phiếu điền sẵn: một phiếu tạm bán vượt tồn (⇒ "Hàng cần đặt") và một phiếu bán đã ghi sổ (⇒ "Thu tiền phiếu này")
    const kho1 = await api.wh('KHO1');
    const tc = await api.findByCode('partners', 'THANHCONG');
    await api.post('/documents', { doc_type: 'sale', partner_id: tc.id, warehouse_id: kho1.id, doc_date: '2026-11-03', lines: [{ product_code: 'COS10', qty: 500 }] });
    const sold = await api.postedDoc({ doc_type: 'sale', doc_date: '2026-11-03', partner_id: tc.id, warehouse_id: kho1.id, lines: [{ product_code: QUE.code, qty: 1 }] });
    const res = {};
    const NEW = p.getByText('PHIẾU MỚI — chưa lưu', { exact: true });
    for (const t of ['sale', 'sale_return', 'purchase', 'purchase_return', 'transfer', 'opening']) {
      res[`phiếu ${t}`] = await sampleUntouched(p, () => p.goto(`/chung-tu/moi?loai=${t}`), NEW);
    }
    for (const t of ['receipt', 'payment']) {
      res[`phiếu ${t}`] = await sampleUntouched(p, () => p.goto(`/phieu-thu-chi/moi?loai=${t}`), NEW);
    }
    // phiếu mới bằng F2 từ danh sách (không tải lại trang)
    res['F2 phiếu bán'] = await sampleUntouched(p, async () => { await p.goto('/'); await ui.menu(p, 'Bán hàng', 'Phiếu bán'); await p.evaluate(() => (window.__unsavedWrites = [])); await p.locator('body').press('F2'); }, NEW);
    res['F2 thu tiền'] = await sampleUntouched(p, async () => { await p.goto('/'); await ui.menu(p, 'Quỹ & Ngân hàng', 'Thu tiền'); await p.evaluate(() => (window.__unsavedWrites = [])); await p.locator('body').press('F2'); }, NEW);
    // điền sẵn: "Lập phiếu nhập cho … mã thiếu" và "Thu tiền phiếu này"
    res['phiếu nhập điền sẵn (Hàng cần đặt)'] = await sampleUntouched(
      p,
      async () => {
        await p.goto('/');
        await ui.menu(p, 'Mua hàng', 'Hàng cần đặt');
        await p.evaluate(() => (window.__unsavedWrites = []));
        await p.getByRole('button', { name: /Lập phiếu nhập cho \d+ mã thiếu/ }).click();
      },
      p.getByText(/Đã điền sẵn \d+ mã thiếu/),
    );
    res['phiếu thu điền sẵn (Thu tiền phiếu này)'] = await sampleUntouched(
      p,
      async () => {
        await p.goto(`/chung-tu/${sold.id}`);
        await expect(p.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
        await p.evaluate(() => (window.__unsavedWrites = []));
        await p.getByRole('button', { name: 'Thu tiền phiếu này' }).click();
      },
      NEW,
    );
    await ui.shot(p, 'F19-phieu-moi-khong-luu-ban-go-do');
    const bad = Object.entries(res).filter(([, r]) => r.seen.length || r.writes.length || r.dirty).map(([k, r]) => `${k}: ${JSON.stringify(r)}`);
    expect(bad).toEqual([]);
    // đối chứng: gõ thật một chữ ghi chú ⇒ CÓ bản gõ dở (móc bắt được ghi thật)
    await p.goto('/chung-tu/moi?loai=sale');
    await expect(NEW).toBeVisible();
    await p.getByLabel('Ghi chú', { exact: true }).fill('x');
    await ui.focusBlankCode(p);
    await ui.typeLine(p, { code: QUE.code, qty: 1 });
    await expect.poll(() => unsavedKeys(p)).toHaveLength(1);
    expect((await p.evaluate(() => window.__unsavedWrites)).length).toBeGreaterThan(0); // móc ghi nhận được lần ghi thật
    await p.getByRole('complementary').getByRole('link', { name: 'Tổng quan', exact: true }).click();
    await p.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' }).getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
    await expect.poll(() => unsavedKeys(p)).toEqual([]);
    await c.close();
  });

  test('REQ-UX F-04 F-19 Lặp 8 lần: phiên lan ngắt giữa chừng, hoa đăng nhập cùng cửa sổ ⇒ hoa KHÔNG BAO GIỜ thấy "Đã khôi phục"; lan quay lại thì được khôi phục phiếu của mình', async ({ browser }) => {
    const users = (await api.get('/users')).items;
    const hoaId = users.find((u) => u.username === 'hoa').id;
    const lanId = users.find((u) => u.username === 'lan').id;
    const res = [];
    for (let i = 0; i < 8; i++) {
      const { ctx: c, page: p } = await openAs(browser, 'lan', 'lan123456', `lan→hoa ${i}`);
      const note = `Phiếu riêng của Lan ${i}`;
      await ui.enterDoc(p, { type: 'sale', partner: 'THANHCONG', partnerName: THANHCONG.name, wh: 'KHO1', note, lines: [{ code: QUE.code, qty: i + 1 }], action: 'none' });
      await killLan();
      await p.keyboard.press('Control+s');
      await reLogin(p, 'hoa', 'hoa123456');
      await p.goto('/chung-tu/moi?loai=sale');
      await expect(p.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
      await p.waitForTimeout(1500); // mọi giá trị tự điền và thông báo (nếu có) đã hiện
      const notes = await p.locator('.ant-message-notice').filter({ hasText: RESTORED }).count();
      const dirty = await p.getByText('Có thay đổi chưa lưu').count();
      const keys = await unsavedKeys(p);
      const hoaKeys = keys.filter((k) => k.startsWith(`kho.unsaved.${hoaId}.`));
      const lanKeys = keys.filter((k) => k.startsWith(`kho.unsaved.${lanId}.`));
      // hoa đi xem màn khác: không bị hỏi "Phiếu chưa lưu"
      await ui.clickMenu(p, 'Kho', 'Tồn kho');
      const asked = await p.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' }).waitFor({ timeout: 1000 }).then(() => true, () => false);
      if (notes || dirty || asked) await ui.shot(p, `F19-hoa-lan-${i}`);
      let lanBack = '-';
      if (i % 3 === 0) {
        // lan quay lại: hoa đăng xuất, lan đăng nhập ⇒ phiếu gõ dở của lan được khôi phục
        await p.goto('/');
        await p.getByRole('button', { name: /Đăng xuất/ }).click();
        await p.locator('.ant-modal-confirm').getByRole('button', { name: 'Đăng xuất' }).click();
        await ui.login(p, 'lan', 'lan123456');
        await p.goto('/chung-tu/moi?loai=sale');
        await expect(p.locator('.ant-message-notice').filter({ hasText: RESTORED })).toBeVisible();
        await expect.poll(async () => (await ui.readLines(p)).map((l) => `${l.code}:${ui.vnNum(l.qty)}`)).toEqual([`${QUE.code}:${i + 1}`]);
        await expect(p.getByLabel('Ghi chú', { exact: true })).toHaveValue(note);
        lanBack = 'khôi phục';
      }
      res.push(`${i}: hoa thông báo=${notes} thayđổi=${dirty} hỏi=${asked} khóa hoa=${hoaKeys.length} khóa lan=${lanKeys.length} lan quay lại=${lanBack}`);
      await c.close();
    }
    expect(res).toEqual([...Array(8).keys()].map((i) => `${i}: hoa thông báo=0 thayđổi=0 hỏi=false khóa hoa=0 khóa lan=1 lan quay lại=${i % 3 === 0 ? 'khôi phục' : '-'}`));
  });

  test('REQ-UX Ô đầu phiếu có nhãn thật (bấm/đọc theo tên): Ngày hạch toán, Khách hàng, Xuất từ kho, Ghi chú', async ({ browser }) => {
    const { ctx: c6, page: p } = await openAs(browser, 'hoa', 'hoa123456', 'hoa (nhãn)');
    await p.goto('/chung-tu/moi?loai=sale');
    for (const [label, id] of [['Ngày hạch toán', 'doc_date'], ['Khách hàng', 'partner'], ['Xuất từ kho', 'warehouse'], ['Ghi chú', 'note']]) {
      await expect(p.getByLabel(label, { exact: true })).toHaveAttribute('id', id);
    }
    await p.goto('/chung-tu/moi?loai=transfer');
    await expect(p.getByLabel('Kho xuất', { exact: true })).toHaveAttribute('id', 'warehouse');
    await expect(p.getByLabel('Kho nhận', { exact: true })).toHaveAttribute('id', 'to_warehouse');
    await c6.close();
  });

  test('REQ-UX Màn hẹp 1024px: nút ít dùng của phiếu đã ghi sổ nằm trong "Thêm ▾", đều bấm được; không cuộn ngang', async ({ browser }) => {
    const { ctx: c7, page: p } = await openAs(browser, 'hoa', 'hoa123456', 'hoa (1024)');
    await p.setViewportSize({ width: 1024, height: 768 });
    const cus = await api.findByCode('partners', 'THANHCONG');
    const kho1 = await api.wh('KHO1');
    const d = await api.postedDoc({ doc_type: 'sale', doc_date: '2026-10-20', partner_id: cus.id, warehouse_id: kho1.id, lines: [{ product_code: 'COS10', qty: 1 }] });
    await p.goto(`/chung-tu/${d.id}`);
    await expect(p.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sw[0]).toBeLessThanOrEqual(sw[1]);
    await expect(p.getByRole('button', { name: /Sửa phiếu/ })).toBeVisible();
    await p.getByRole('button', { name: /Thêm ▾/ }).click();
    const items = await p.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role=menuitem]').allInnerTexts();
    expect(items.map((t) => t.trim())).toEqual(['Thu tiền phiếu này', 'Bỏ ghi sổ', 'In (Ctrl+P)', 'Xuất Excel (.xlsx)', 'Xuất Word (.docx)', 'Lịch sử sửa phiếu']);
    await p.getByRole('menuitem', { name: /In \(Ctrl\+P\)/ }).click();
    await expect(p.locator('.ant-modal').filter({ has: p.locator('.print-sheet') })).toBeVisible();
    await p.keyboard.press('Escape');
    await p.getByRole('button', { name: /Thêm ▾/ }).click();
    const dl = await ui.download(p, () => p.getByRole('menuitem', { name: /Xuất Excel/ }).click(), '14-xuat-man-hep.xlsx');
    expect(dl.suggested).toBe(`${d.doc_no}.xlsx`);
    await p.getByRole('button', { name: /Thêm ▾/ }).click();
    await p.getByRole('menuitem', { name: /Lịch sử sửa phiếu/ }).click();
    await expect(p.locator('.ant-drawer-open').filter({ hasText: 'Lịch sử sửa phiếu' })).toBeVisible();
    await ui.shot(p, '14-man-hep-them');
    await c7.close();
  });

  test('REQ-090 Đổi mật khẩu (bấm tên góc phải › Đổi mật khẩu) rồi đăng nhập bằng mật khẩu mới', async ({ browser }) => {
    await api.ensureUser('tam', 'Lê Văn Tâm (Kho)', 'tam123456');
    const { ctx: c4, page: p4 } = await openAs(browser, 'tam', 'tam123456', 'tam');
    await p4.getByRole('button', { name: 'Tài khoản', exact: true }).click();
    await p4.getByRole('menuitem', { name: /Đổi mật khẩu/ }).click();
    const dlg = p4.getByRole('dialog', { name: 'Đổi mật khẩu' });
    await dlg.getByLabel('Mật khẩu hiện tại').fill('tam123456');
    await dlg.getByLabel(/^Mật khẩu mới\s*\*?$/).fill('tam654321');
    await dlg.getByLabel('Gõ lại mật khẩu mới').fill('tam654321');
    await dlg.getByRole('button', { name: /Đổi mật khẩu|Lưu/ }).last().click();
    await expect(dlg).toBeHidden();
    await p4.getByRole('button', { name: /Đăng xuất/ }).click();
    await p4.locator('.ant-modal-confirm').getByRole('button', { name: 'Đăng xuất' }).click();
    await ui.login(p4, 'tam', 'tam654321');
    await c4.close();
  });

  test('REQ-UX Không cuộn ngang ở 1366×768 và không còn chữ tiếng Anh / mã lỗi thô trên mọi màn chính', async () => {
    const { page: admin, ctx: ca } = await openAs(page.context().browser(), 'admin', 'admin123', 'admin');
    const screens = [
      '/', '/ban-hang/phieu-ban', '/ban-hang/khach-tra-hang', '/ban-hang/phieu-tam', '/mua-hang/phieu-nhap', '/mua-hang/tra-hang-ncc',
      '/mua-hang/hang-can-dat', '/kho/ton-kho', '/kho/the-kho', '/kho/tong-hop-nxt', '/kho/chuyen-kho', '/kho/ton-dau-ky',
      '/cong-no/phai-thu', '/cong-no/phai-tra', '/quy/thu', '/quy/chi', '/quy/so-quy', '/bao-cao', '/bao-cao/ban-hang',
      '/bao-cao/lich-su-ban', '/bao-cao/mua-hang', '/danh-muc/hang-hoa', '/danh-muc/nhom-hang', '/danh-muc/khach-hang',
      '/danh-muc/nha-cung-cap', '/danh-muc/kho', '/danh-muc/tai-khoan-tien', '/he-thong/nguoi-dung', '/he-thong/thong-tin-cong-ty',
      '/huong-dan', '/chung-tu/moi?loai=sale', '/chung-tu/moi?loai=purchase', '/chung-tu/moi?loai=transfer', '/chung-tu/moi?loai=opening',
      '/phieu-thu-chi/moi?loai=receipt', '/phieu-thu-chi/moi?loai=payment',
    ];
    const docs = await api.get('/documents?page_size=500');
    const seen = new Set();
    for (const d of docs.items) {
      const k = `${d.doc_type}:${d.status}`;
      if (!seen.has(k)) {
        seen.add(k);
        screens.push(`/chung-tu/${d.id}`);
      }
    }
    const vs = await api.get('/vouchers?page_size=500');
    for (const v of vs.items.slice(0, 2)) screens.push(`/phieu-thu-chi/${v.id}`);
    // Tên phím trên bàn phím (Delete, Enter, Esc, Ctrl, Alt, Insert, Tab…) được phép.
    const EN = /\b(Error|Loading|Submit|Cancel|Save|Edit|Search|No data|undefined|null|NaN|Invalid date|Not Found|Unauthorized|Failed|Close|OK|Yes|Next|Previous|items|Select|Required)\b|\[object Object\]|\b[A-Z]{3,}_[A-Z_]{3,}\b/g;
    const problems = [];
    for (const s of screens) {
      await admin.goto(s);
      await expect(admin.getByRole('button', { name: 'Tài khoản', exact: true })).toBeVisible();
      await expect(admin.locator('.ant-skeleton, .ant-spin-spinning')).toHaveCount(0);
      const m = await admin.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, text: document.body.innerText }));
      if (m.sw > m.cw) problems.push(`${s}: cuộn ngang ${m.sw} > ${m.cw}`);
      const en = [...new Set(m.text.match(EN) ?? [])];
      if (en.length) problems.push(`${s}: chữ tiếng Anh/mã lỗi ${JSON.stringify(en)}`);
    }
    await ca.close();
    expect(problems).toEqual([]);
  });
});
