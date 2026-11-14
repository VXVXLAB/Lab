// Câu chuyện 10 — Công nợ khách hàng và nhà cung cấp sau bán, mua, trả hàng, thu, chi; mở chi tiết từ tổng hợp công nợ
// → sổ chi tiết → phiếu/phiếu thu chi, rồi Esc lùi từng lớp, KHÔNG rời màn báo cáo (YEU_CAU mục 5).
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, findRow } = require('../lib/files');

test.describe.configure({ mode: 'serial' });

const P = { code: 'BEPCAT80', name: 'Bép cắt plasma P80', unit: 'Cái', group_code: 'BEC', group_name: 'Béc – bép hàn', sale_price: 25000, purchase_price: 15000 };
const CUS = { code: 'MINHTAM', name: 'Công ty TNHH Xây dựng Minh Tâm', is_customer: true, opening_receivable: 3000000, phone: '0903 111 222' };
const SUP = { code: 'TANTHANH', name: 'Công ty TNHH Thép Tân Thành', is_supplier: true, opening_payable: 4000000, phone: '0274 222 111' };

test.describe('Câu chuyện 10: công nợ và mở chi tiết tại chỗ', () => {
  let page;
  let ctx;
  const no = {};
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    await api.ensureProduct(P);
    await api.ensurePartner(CUS);
    await api.ensurePartner(SUP);
    await api.openingStock('KHO1', '2026-01-01', [{ product_code: P.code, qty: 200 }]);
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    ({ ctx, page } = await openAs(browser, 'lan', 'lan123456', 'lan'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-034 REQ-052 Phát sinh với khách Minh Tâm: bán 1.000.000, khách trả hàng 100.000, thu tiền mặt 500.000', async () => {
    no.xk = await ui.enterDoc(page, { type: 'sale', date: '02/10/2026', partner: 'minh tam', partnerName: CUS.name, wh: 'KHO1', lines: [{ code: P.code, qty: 40 }] });
    no.nkTra = await ui.enterDoc(page, { type: 'sale_return', date: '05/10/2026', partner: 'minh tam', partnerName: CUS.name, wh: 'KHO1', lines: [{ code: P.code, qty: 4 }] });
    no.pt = await ui.enterVoucher(page, { type: 'receipt', account: 'TM', date: '08/10/2026', partner: 'minh tam', partnerName: CUS.name, lines: [{ desc: 'Thu tiền hàng tháng 10', amount: 500000 }] });
    expect(no.pt).toMatch(/^PT\d{5}$/);
  });

  test('REQ-054 Phát sinh với NCC Tân Thành: mua 1.500.000, trả hàng NCC 150.000, chi tiền mặt 1.000.000', async () => {
    no.nk = await ui.enterDoc(page, { type: 'purchase', date: '03/10/2026', partner: 'tan thanh', partnerName: SUP.name, wh: 'KHO1', lines: [{ code: P.code, qty: 100 }] });
    no.xkTra = await ui.enterDoc(page, { type: 'purchase_return', date: '06/10/2026', partner: 'tan thanh', partnerName: SUP.name, wh: 'KHO1', lines: [{ code: P.code, qty: 10 }] });
    no.pc = await ui.enterVoucher(page, { type: 'payment', account: 'TM', date: '09/10/2026', partner: 'tan thanh', partnerName: SUP.name, lines: [{ desc: 'Trả tiền thép tháng 10', amount: 1000000 }] });
    expect(no.pc).toMatch(/^PC\d{5}$/);
  });

  test('REQ-052 REQ-065 REQ-084 Phải thu: đầu kỳ 3.000.000, tăng 1.000.000, giảm 600.000, còn nợ 3.400.000; lọc kỳ đúng', async () => {
    await ui.menu(page, 'Công nợ', 'Phải thu khách hàng');
    let r = await ui.readReport(page, { waitFor: 'MINHTAM' });
    let row = r.obj.find((x) => x['Mã'] === 'MINHTAM');
    expect(['Đầu kỳ', 'Tăng', 'Giảm (đã thu)', 'Khách còn nợ'].map((k) => ui.vnNum(row[k]))).toEqual([3000000, 1000000, 600000, 3400000]);
    expect(row['Điện thoại']).toBe('0903 111 222');
    // kỳ 01/10–06/10: chưa có phiếu thu
    await ui.setRange(page, page.locator('.toolbar'), '01/10/2026', '06/10/2026');
    r = await ui.readReport(page, { waitFor: 'MINHTAM' });
    row = r.obj.find((x) => x['Mã'] === 'MINHTAM');
    expect(['Đầu kỳ', 'Tăng', 'Giảm (đã thu)', 'Khách còn nợ'].map((k) => ui.vnNum(row[k]))).toEqual([3000000, 1000000, 100000, 3900000]);
    await ui.setRange(page, page.locator('.toolbar'));
    await ui.shot(page, '10-cong-no-phai-thu');
  });

  test('REQ-053 REQ-069 REQ-086 Bấm khách → sổ chi tiết; bấm dòng phiếu bán → xem phiếu; Esc lùi từng lớp, vẫn ở màn công nợ', async () => {
    const url = page.url();
    await ui.readReport(page, { waitFor: 'MINHTAM' });
    await page.getByRole('row', { name: /MINHTAM/ }).click();
    const led = ui.topDrawer(page);
    await expect(led).toContainText(`Công nợ phải thu — MINHTAM ${CUS.name}`);
    const r = await ui.readReport(led, { waitFor: no.pt });
    expect(r.rows[0]).toContain('Nợ đầu kỳ (khai báo ở danh mục)');
    const pick = (ref) => r.obj.find((x) => x['Số chứng từ'] === ref);
    expect([pick(no.xk)['Ngày'], ui.vnNum(pick(no.xk)['Tăng']), ui.vnNum(pick(no.xk)['Số dư'])]).toEqual(['02/10/2026', 1000000, 4000000]);
    expect([ui.vnNum(pick(no.nkTra)['Giảm (đã thu)']), ui.vnNum(pick(no.nkTra)['Số dư'])]).toEqual([100000, 3900000]);
    expect([ui.vnNum(pick(no.pt)['Giảm (đã thu)']), ui.vnNum(pick(no.pt)['Số dư'])]).toEqual([500000, 3400000]);
    expect(pick(no.pt)['Diễn giải']).toContain('Thu tiền mặt');
    await expect(led.locator('.debt-headline')).toContainText('Khách còn nợ hiện tại: 3.400.000 đ');
    // tầng 2: phiếu bán
    await led.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: no.xk }).click();
    const doc = ui.topDrawer(page);
    await expect(doc).toContainText(`Chứng từ ${no.xk}`);
    await expect(doc).toContainText('tầng 2');
    await expect(doc).toContainText(P.name);
    await expect(doc).toContainText('1.000.000');
    await ui.shot(page, '10-mo-chi-tiet-tang-2');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(1);
    // tầng 2: phiếu thu
    await led.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: no.pt }).click();
    const v = ui.topDrawer(page);
    await expect(v).toContainText(`Phiếu ${no.pt}`);
    await expect(v).toContainText('Thu tiền hàng tháng 10');
    await expect(v).toContainText('Bằng chữ: Năm trăm nghìn đồng');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
    expect(page.url()).toBe(url);
    await expect(page.getByRole('heading', { name: 'Công nợ phải thu khách hàng' })).toBeVisible();
  });

  test('REQ-054 REQ-055 REQ-069 Phải trả: còn nợ 4.350.000; sổ chi tiết NCC có mua, trả hàng, phiếu chi; mở phiếu tại chỗ', async () => {
    await ui.menu(page, 'Công nợ', 'Phải trả nhà cung cấp');
    const r = await ui.readReport(page, { waitFor: 'TANTHANH' });
    const row = r.obj.find((x) => x['Mã'] === 'TANTHANH');
    expect(['Đầu kỳ', 'Tăng', 'Giảm (đã trả)', 'Mình còn nợ'].map((k) => ui.vnNum(row[k]))).toEqual([4000000, 1500000, 1150000, 4350000]);
    await page.getByRole('row', { name: /TANTHANH/ }).click();
    const led = ui.topDrawer(page);
    const l = await ui.readReport(led, { waitFor: no.pc });
    expect(l.obj.filter((x) => x['Số chứng từ']).map((x) => x['Số chứng từ'])).toEqual([no.nk, no.xkTra, no.pc]);
    expect(ui.vnNum(l.obj.find((x) => x['Số chứng từ'] === no.xkTra)['Giảm (đã trả)'])).toBe(150000);
    await led.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: no.xkTra }).click();
    await expect(ui.topDrawer(page)).toContainText(`Chứng từ ${no.xkTra}`);
    await expect(ui.topDrawer(page)).toContainText('Phiếu trả hàng nhà cung cấp');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
  });

  test('REQ-065 REQ-087 Xuất Excel tổng hợp công nợ phải trả khớp màn hình', async () => {
    const r = await ui.readReport(page, { waitFor: 'TANTHANH' });
    const { file } = await ui.download(page, () => page.getByRole('button', { name: 'Xuất Excel' }).click(), '10-cong-no-phai-tra.xlsx');
    const x = await readXlsx(file);
    expect(x.isProtected).toBe(false);
    const ri = findRow(x.rows, 'TANTHANH');
    const xr = x.rows[ri];
    const nums = xr.filter((v) => typeof v === 'number');
    expect(nums.slice(-4)).toEqual([4000000, 1500000, 1150000, 4350000]);
    const tot = x.rows[findRow(x.rows, /^Cộng/)];
    expect(tot.filter((v) => typeof v === 'number').slice(-1)[0]).toBe(ui.vnNum(r.sum['Mình còn nợ']));
    const dataRows = x.rows.slice(findRow(x.rows, 'Đầu kỳ') + 1, findRow(x.rows, /^Cộng/)).filter((rr) => rr && rr.some((v) => v !== null));
    expect(dataRows.length).toBe(r.rows.length);
  });

  test('REQ-062 Từ sổ chi tiết công nợ bấm "Thu tiền": phiếu thu mới đã chọn sẵn đúng khách', async () => {
    await ui.menu(page, 'Công nợ', 'Phải thu khách hàng');
    await ui.readReport(page, { waitFor: 'MINHTAM' });
    await page.getByRole('row', { name: /MINHTAM/ }).click();
    await ui.topDrawer(page).getByRole('button', { name: 'Thu tiền', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Phiếu thu tiền' })).toBeVisible();
    await expect(page.locator('.hf-partner .ant-select-selection-item')).toContainText(`MINHTAM – ${CUS.name}`);
    await expect(page.locator('.debt-line')).toContainText('trước phiếu này 3.400.000');
    await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
  });

  // F-08 (đã sửa, kiểm lại cả hai chiều): giá trị phần mềm tự điền là mốc ⇒ chưa gõ gì thì rời đi KHÔNG hỏi;
  // gõ bất cứ gì thì PHẢI hỏi.
  const leave = async (group, item, heading) => {
    await ui.clickMenu(page, group, item);
    const c = page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
    const asked = await c.waitFor({ timeout: 2000 }).then(() => true, () => false);
    return { asked, c, heading };
  };

  test('REQ-UX F-08: phiếu thu vừa mở từ "Thu tiền", chưa gõ gì ⇒ rời đi không bị hỏi', async () => {
    const r = await leave('Công nợ', 'Phải thu khách hàng');
    if (r.asked) await r.c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
    await expect(page.getByRole('heading', { name: 'Công nợ phải thu khách hàng' })).toBeVisible();
    expect(r.asked).toBe(false);
  });

  test('REQ-UX F-08: mở từ "Thu tiền" rồi gõ ghi chú ⇒ rời đi PHẢI hỏi; "Ở lại phiếu" giữ chữ đã gõ', async () => {
    await ui.readReport(page, { waitFor: 'MINHTAM' });
    await page.getByRole('row', { name: /MINHTAM/ }).click();
    await ui.topDrawer(page).getByRole('button', { name: 'Thu tiền', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Phiếu thu tiền' })).toBeVisible();
    await page.getByLabel('Ghi chú / lý do').fill('Khách hẹn chuyển khoản');
    let r = await leave('Công nợ', 'Phải thu khách hàng');
    expect(r.asked).toBe(true);
    await r.c.getByRole('button', { name: 'Ở lại phiếu' }).click();
    await expect(page.getByLabel('Ghi chú / lý do')).toHaveValue('Khách hẹn chuyển khoản');
    // dòng tiền gõ thêm cũng tính là thay đổi
    await page.locator('[data-vcell$=":desc"]').last().click();
    await page.keyboard.type('Thu một phần');
    r = await leave('Công nợ', 'Phải thu khách hàng');
    expect(r.asked).toBe(true);
    await r.c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
    await expect(page.getByRole('heading', { name: 'Công nợ phải thu khách hàng' })).toBeVisible();
  });

  test('REQ-UX F-08: phiếu thu mới (F2, chỉ có tài khoản mặc định) chưa gõ gì ⇒ không hỏi; chọn khách ⇒ hỏi', async () => {
    await ui.menu(page, 'Quỹ & Ngân hàng', 'Thu tiền');
    await page.locator('body').press('F2');
    await expect(page.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
    let r = await leave('Quỹ & Ngân hàng', 'Chi tiền');
    expect(r.asked).toBe(false);
    await expect(page.getByRole('heading', { name: /^Phiếu chi tiền/ })).toBeVisible();
    await page.locator('body').press('F2');
    await expect(page.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
    await ui.selectByTyping(page, page.locator('#partner'), 'TANTHANH', /Tân Thành/);
    r = await leave('Quỹ & Ngân hàng', 'Thu tiền');
    expect(r.asked).toBe(true);
    await r.c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
  });

  test('REQ-062 Từ phiếu bán đã ghi sổ bấm "Thu tiền phiếu này": phiếu thu điền sẵn khách, chứng từ liên quan và số tiền; chưa sửa ⇒ không hỏi, sửa số tiền ⇒ hỏi', async () => {
    const openFromSale = async () => {
      await ui.menu(page, 'Bán hàng', 'Phiếu bán');
      await page.getByPlaceholder('Số phiếu, tên đối tác, ghi chú…').fill(no.xk);
      await page.getByRole('row', { name: new RegExp(no.xk) }).dblclick();
      await expect(page.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Thu tiền phiếu này' }).click();
      await expect(page.getByRole('heading', { name: 'Phiếu thu tiền' })).toBeVisible();
    };
    await openFromSale();
    await expect(page.locator('.hf-partner .ant-select-selection-item')).toContainText(CUS.name);
    const row = page.locator('.voucher-editor .line-grid tbody tr').first();
    await expect(row.locator('[data-vcell$=":desc"]')).toHaveValue(`Thu tiền phiếu ${no.xk} ngày 02/10/2026`);
    await expect(row).toContainText(no.xk);
    await expect(row.getByLabel('Số tiền dòng 1')).toHaveValue('1.000.000');
    await expect(page.locator('.money-words')).toHaveText('Bằng chữ: Một triệu đồng');
    let r = await leave('Công nợ', 'Phải thu khách hàng');
    expect(r.asked).toBe(false);
    await expect(page.getByRole('heading', { name: 'Công nợ phải thu khách hàng' })).toBeVisible();
    await openFromSale();
    // sửa sau khi dòng điền sẵn đã hiện (như người dùng nhìn thấy dòng rồi mới sửa)
    await expect(page.locator('.voucher-editor .line-grid tbody tr').first().getByLabel('Số tiền dòng 1')).toHaveValue('1.000.000');
    await page.locator('.voucher-editor .line-grid tbody tr').first().getByLabel('Số tiền dòng 1').fill('600000');
    await expect(page.locator('.money-words')).toHaveText('Bằng chữ: Sáu trăm nghìn đồng');
    r = await leave('Công nợ', 'Phải thu khách hàng');
    expect(r.asked).toBe(true);
    await r.c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click();
    await expect(page.getByRole('heading', { name: 'Công nợ phải thu khách hàng' })).toBeVisible();
  });

  test('REQ-069 REQ-UX Sổ chi tiết công nợ trong ngăn kéo có nút In: chỉ in ngăn kéo đó', async () => {
    await ui.readReport(page, { waitFor: 'MINHTAM' });
    await page.getByRole('row', { name: /MINHTAM/ }).click();
    const dr = ui.topDrawer(page);
    await ui.readReport(dr, { waitFor: no.pt });
    await ui.checkDrawerPrint(page, dr, no.pt);
    await page.keyboard.press('Escape');
  });
});
