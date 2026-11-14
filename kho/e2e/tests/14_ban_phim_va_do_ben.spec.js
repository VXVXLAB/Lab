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

  // PHÁT HIỆN F-05 (BAO_CAO_E2E.md): ô tìm của danh mục chờ 250 ms rồi mới hỏi máy chủ, và trong lúc chờ vẫn để nguyên
  // danh sách CŨ; Enter ở ô tìm chọn dòng đầu của danh sách đang hiện ⇒ gõ tên rồi Enter, Enter là mở nhầm khách khác.
  // Mạng nội bộ chậm (máy chủ trả lời sau ~0,6 s) được giả lập để kết quả không phụ thuộc tốc độ máy chạy test.
  test.fail('REQ-UX Gõ tìm "thanh cong" rồi Enter, Enter: mở đúng khách Thành Công (không mở nhầm dòng của danh sách cũ)', async () => {
    await ui.menu(page, 'Danh mục', 'Khách hàng');
    // tải lại trang: bỏ bộ nhớ đệm kết quả tìm của test trước (người dùng mới mở màn này)
    await page.reload();
    await expect(page.locator('.ant-table-tbody tr.ant-table-row').nth(1)).toBeVisible();
    const first = (await page.locator('.ant-table-tbody tr.ant-table-row').first().locator('td').first().innerText()).trim();
    expect(first).not.toBe('THANHCONG');
    const slow = async (route) => {
      await new Promise((r) => setTimeout(r, 600)); // độ trễ mạng giả lập
      await route.continue();
    };
    await page.route(/\/api\/partners\?.*q=/, slow);
    try {
      await ui.blurAll(page);
      await page.keyboard.press('/');
      await page.keyboard.type('thanh cong', { delay: 60 }); // ~16 phím/giây
      await page.waitForTimeout(80); // nhịp tay giữa chữ cuối và Enter (người thật)
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
      await page.keyboard.press('Enter');
      // Mong đợi: hộp "Sửa khách hàng THANHCONG". Thực tế: mở nhầm khách đầu danh sách cũ, hoặc không mở gì
      // (lựa chọn bị xóa khi bộ lọc chạy giữa hai lần Enter) — cả hai đều sai.
      const dlg = page.getByRole('dialog').filter({ hasText: /Sửa khách hàng/ });
      const opened = await dlg.waitFor({ timeout: 3000 }).then(() => true, () => false);
      const title = opened ? await dlg.locator('.ant-modal-title').innerText() : '(không mở hộp thoại nào)';
      await ui.shot(page, 'F05-danh-muc-mo-nham-khach');
      if (opened) {
        await expect(dlg.getByLabel(/^Mã\s*\*?$/)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(dlg).toBeHidden();
      }
      expect(title).toBe('Sửa khách hàng THANHCONG');
    } finally {
      await page.unroute(/\/api\/partners\?.*q=/, slow);
    }
  });

  // PHÁT HIỆN F-05 (BAO_CAO_E2E.md) — nặng hơn trong phiếu: ô Khách hàng lấy mục đang sáng của kết quả tìm CŨ.
  // Gõ "an phu" rồi Enter như hướng dẫn ("gõ vài chữ tên … rồi Enter") ⇒ phiếu nhận khách "An Bình" (kết quả của "an"),
  // con trỏ nhảy sang ô Kho nên rất dễ không để ý. Mạng nội bộ chậm (~0,6 s) được giả lập để kết quả ổn định.
  test.fail('REQ-025 REQ-UX Phiếu bán: gõ "an phu" rồi Enter chọn đúng khách An Phú (không lấy kết quả tìm cũ)', async () => {
    await ui.menu(page, 'Bán hàng', 'Phiếu bán');
    await ui.newDocByF2(page, /^Phiếu bán hàng/);
    await expect(page.locator('#partner')).toBeFocused();
    const slow = async (route) => {
      await new Promise((r) => setTimeout(r, 600)); // độ trễ mạng giả lập
      await route.continue();
    };
    await page.route(/\/api\/partners\?/, slow);
    try {
      await page.keyboard.type('an phu', { delay: 60 });
      await page.waitForTimeout(80); // nhịp tay trước Enter
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500); // chờ mọi kết quả tìm về hết rồi mới đọc ô đã chọn
      const chosen = await page.locator('.hf-partner .ant-select-selection-item').innerText().catch(() => '(chưa chọn khách)');
      await ui.shot(page, 'F05-phieu-ban-chon-nham-khach');
      expect(chosen).toBe('ANPHU – Cơ khí An Phú');
    } finally {
      await page.unroute(/\/api\/partners\?/, slow);
      // rời phiếu nháp này (đã chọn khách ⇒ có chặn rời trang)
      await ui.clickMenu(page, 'Bán hàng', 'Phiếu bán');
      const c = page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
      await c.waitFor({ timeout: 3000 }).then(
        () => c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click(),
        () => undefined,
      );
      await expect(page.getByRole('heading', { name: /^Phiếu bán hàng/ })).toBeVisible();
    }
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

  // PHÁT HIỆN F-07 (BAO_CAO_E2E.md): ô đối tác của phiếu thu/chi tìm trên chuỗi "mã + tên" và xếp kết quả theo MÃ, không theo
  // mức khớp: gõ "thanh cong" thì "TANTHANH Công ty TNHH Thép Tân Thành" (tanTHANH CONG ty…) đứng đầu và được chọn khi Enter.
  test.fail('REQ-060 REQ-UX Phiếu thu: gõ "thanh cong" rồi Enter chọn đúng Xưởng cơ khí Thành Công', async () => {
    await ui.menu(page, 'Quỹ & Ngân hàng', 'Thu tiền');
    await page.locator('body').press('F2');
    await expect(page.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
    await expect(page.locator('#partner')).toBeFocused();
    try {
      await page.keyboard.type('thanh cong', { delay: 60 });
      // chờ danh sách gợi ý của đúng chữ đã gõ hiện ra (người dùng nhìn thấy rồi mới Enter)
      const opts = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
      await expect(opts.filter({ hasText: 'THANHCONG' })).toBeVisible();
      // danh sách đã lọc xong theo chữ vừa gõ: mọi mục đều có "thanh"
      await expect.poll(async () => (await opts.allInnerTexts()).every((t) => /thanh|thành/i.test(t))).toBe(true);
      await page.keyboard.press('Enter');
      await expect(page.locator('.hf-partner .ant-select-selection-item')).toBeVisible();
      await ui.shot(page, 'F07-phieu-thu-chon-nham-doi-tac');
      expect(await page.locator('.hf-partner .ant-select-selection-item').innerText()).toBe(`THANHCONG – ${THANHCONG.name}`);
    } finally {
      await ui.clickMenu(page, 'Quỹ & Ngân hàng', 'Chi tiền');
      const c = page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
      await c.waitFor({ timeout: 2000 }).then(
        () => c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click(),
        () => undefined,
      );
      await expect(page.getByRole('heading', { name: /^Phiếu chi tiền/ })).toBeVisible();
    }
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

  // PHÁT HIỆN F-04 (BAO_CAO_E2E.md): phiên hết hạn trong lúc đang gõ phiếu (vd. kế toán đổi mật khẩu ở máy khác,
  // quản trị đặt lại mật khẩu) ⇒ bấm Ctrl+S đưa về màn đăng nhập và MẤT toàn bộ dòng đang gõ; đăng nhập lại là phiếu trống.
  test.fail('REQ-UX Phiên hết hạn lúc đang gõ phiếu: đăng nhập lại không mất các dòng đã gõ', async ({ browser }) => {
    const { ctx: c3, page: p3 } = await openAs(browser, 'lan', 'lan123456', 'lan (phiên 3)');
    await ui.enterDoc(p3, { type: 'sale', partner: 'thanh cong', partnerName: THANHCONG.name, wh: 'KHO1', lines: [{ code: QUE.code, qty: 2 }, { code: 'COS10', qty: 1 }], action: 'none' });
    const users = await api.get('/users');
    const lan = users.items.find((u) => u.username === 'lan');
    await api.put(`/users/${lan.id}`, { username: 'lan', full_name: lan.full_name, role: lan.role, active: true, password: 'lan123456' });
    await p3.keyboard.press('Control+s');
    await expect(p3.getByText('Phiên làm việc đã hết. Vui lòng đăng nhập lại.')).toBeVisible();
    await p3.getByLabel('Tên đăng nhập').fill('lan');
    await p3.getByLabel('Mật khẩu').fill('lan123456');
    await p3.getByLabel('Mật khẩu').press('Enter');
    await expect(p3.getByRole('button', { name: 'Tài khoản', exact: true })).toBeVisible();
    await ui.shot(p3, 'F04-dang-nhap-lai-mat-phieu');
    try {
      await expect.poll(async () => (await ui.readLines(p3)).map((l) => l.code), { timeout: 5000 }).toEqual([QUE.code, 'COS10']);
    } finally {
      await c3.close();
    }
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
