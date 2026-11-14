// Câu chuyện 7 — Ví dụ của khách (mục KHO 3): tháng 1/2026 mua hàng của NCC (nhiều mặt hàng), tháng 9 mới bán và phát hiện
// nhập sai số ⇒ quay lại phiếu tháng 1 sửa SL và đơn giá. Tồn kho, công nợ NCC, thẻ kho, báo cáo mua hàng đổi theo.
// Sửa làm âm kho bị từ chối, không đổi gì. Lịch sử cho biết ai sửa gì. Sửa phiếu bán cũ (SL/đơn giá) cập nhật công nợ.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');

test.describe.configure({ mode: 'serial' });

const A = { code: 'KT40', name: 'Que hàn Kim Tín KT-421 4.0mm (5kg)', unit: 'Hộp', group_code: 'QH', group_name: 'Que hàn', sale_price: 195000, purchase_price: 150000 };
const B = { code: 'GL26', name: 'Que hàn inox GL-308 2.6mm (2kg)', unit: 'Hộp', group_code: 'QH', group_name: 'Que hàn', sale_price: 260000, purchase_price: 200000 };
const SUP = { code: 'KIMTIN', name: 'Công ty CP Que hàn Kim Tín', is_supplier: true, opening_payable: 0 };
const CUS = { code: 'ANPHU', name: 'Cơ khí An Phú', is_customer: true, opening_receivable: 0 };

test.describe('Câu chuyện 7: sửa chứng từ cũ', () => {
  let lan; // máy 1: lập phiếu tháng 1, phiếu bán tháng 9
  let hoa; // máy 2: phát hiện sai và sửa
  let api;
  const no = {};
  test.beforeAll(async ({ browser }) => {
    api = await Api.login();
    await api.ensureProduct(A);
    await api.ensureProduct(B);
    await api.ensurePartner(SUP);
    await api.ensurePartner(CUS);
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    lan = await openAs(browser, 'lan', 'lan123456', 'lan');
    hoa = await openAs(browser, 'hoa', 'hoa123456', 'hoa');
  });
  test.afterAll(async () => {
    await lan.ctx.close();
    await hoa.ctx.close();
  });

  test('REQ-023 REQ-024 Tháng 1: phiếu nhập mua 2 mặt hàng của Kim Tín (15/01/2026), ghi sổ', async () => {
    no.nk = await ui.enterDoc(lan.page, {
      type: 'purchase',
      date: '15/01/2026',
      partner: 'kim tin',
      partnerName: SUP.name,
      wh: 'KHO4',
      lines: [
        { code: A.code, qty: 100 },
        { code: B.code, qty: 50 },
      ],
    });
    expect(await ui.footerSum(lan.page, 'Cộng')).toBe(25000000);
    expect(await api.debtClosing('KIMTIN', 'payable')).toBe(25000000);
  });

  test('REQ-025 Tháng 9: bán 80 hộp KT40 cho Cơ khí An Phú (10/09/2026)', async () => {
    no.xk = await ui.enterDoc(lan.page, { type: 'sale', date: '10/09/2026', partner: 'an phu', partnerName: CUS.name, wh: 'KHO4', lines: [{ code: A.code, qty: 80 }] });
    expect((await api.stockOf(A.code)).total_stock).toBe(20);
  });

  test('REQ-035 Máy 2 tìm phiếu nhập tháng 1 theo số phiếu (F3) và mở bằng Enter', async () => {
    const p = hoa.page;
    await ui.menu(p, 'Mua hàng', 'Phiếu nhập');
    await expect(p.getByRole('heading', { name: /^Phiếu nhập mua hàng/ })).toBeVisible();
    await p.locator('body').press('F3');
    const search = p.getByPlaceholder('Số phiếu, tên đối tác, ghi chú…');
    await expect(search).toBeFocused();
    await search.fill(no.nk);
    const row = p.getByRole('row', { name: new RegExp(no.nk) });
    await expect(row).toContainText('15/01/2026');
    await expect(p.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(1);
    await search.press('Enter');
    await p.keyboard.press('Enter');
    await expect(p.getByRole('heading', { name: 'Phiếu nhập mua hàng' })).toBeVisible();
    await expect(p.locator('.doc-no')).toContainText(no.nk);
    await expect(p.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
  });

  test('REQ-035 Danh sách phiếu nhập lọc "Có mặt hàng…" (hướng dẫn: tìm phiếu cũ theo mặt hàng), thời gian "Tất cả"', async () => {
    const p = lan.page;
    await ui.menu(p, 'Mua hàng', 'Phiếu nhập');
    await expect(p.getByRole('combobox', { name: 'Khoảng thời gian' }).locator('xpath=ancestor::div[contains(@class,"ant-select")][1]')).toContainText('Tất cả');
    await ui.selectByTyping(p, p.locator('.toolbar .ant-select').filter({ hasText: 'Có mặt hàng…' }).getByRole('combobox'), 'GL26', /GL26 –/);
    const rows = p.locator('.ant-table-tbody tr.ant-table-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(no.nk);
    await expect(rows.first()).toContainText('15/01/2026');
  });

  test('REQ-036 REQ-003 REQ-081 F8 sửa phiếu đã ghi sổ: SL 100 → 120, đơn giá 150.000 → 145.000, Ctrl+S', async () => {
    const p = hoa.page;
    await p.keyboard.press('F8');
    await expect(p.getByText('ĐANG SỬA phiếu đã ghi sổ', { exact: true })).toBeVisible();
    await p.getByLabel('Số lượng dòng 1').click();
    await ui.focused(p, '[data-cell$=":qty"]');
    await p.keyboard.type('120');
    await p.keyboard.press('Enter');
    await ui.focused(p, '[data-cell$=":price"]');
    await p.keyboard.type('145000');
    await p.keyboard.press('Enter');
    expect(await ui.footerSum(p, 'Cộng')).toBe(120 * 145000 + 50 * 200000);
    await p.keyboard.press('Control+s');
    await ui.toast(p, new RegExp(`Đã lưu thay đổi phiếu ${no.nk} — tồn kho, công nợ đã tính lại`));
    await expect(p.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
    await expect(p.locator('.doc-no b').first()).toHaveText(no.nk); // số chính thức giữ nguyên
    await ui.shot(p, '07-sua-phieu-nhap-cu');
  });

  test('REQ-016 REQ-039 REQ-081 Sau sửa: tồn kho, công nợ NCC, thẻ kho và báo cáo mua hàng đều tính lại', async () => {
    const p = hoa.page;
    // tồn kho
    await ui.menu(p, 'Kho', 'Tồn kho');
    await p.getByPlaceholder('Tìm mã, tên hàng…').fill('KT40');
    let r = await ui.readReport(p, { waitFor: 'KT40' });
    const kt = r.obj.find((x) => x['Mã hàng'] === 'KT40');
    expect(ui.vnNum(kt.KHO4)).toBe(40);
    expect(ui.vnNum(kt['Tổng tồn'])).toBe(40);
    // công nợ phải trả
    await ui.menu(p, 'Công nợ', 'Phải trả nhà cung cấp');
    r = await ui.readReport(p, { waitFor: 'KIMTIN' });
    const kimtin = r.obj.find((x) => x['Mã'] === 'KIMTIN');
    expect(ui.vnNum(kimtin['Mình còn nợ'])).toBe(27400000);
    // thẻ kho
    await ui.menu(p, 'Kho', 'Thẻ kho / NXT');
    await ui.selectByTyping(p, p.locator('.toolbar .ant-select').first().getByRole('combobox'), 'KT40', /KT40 –/);
    await ui.setRange(p, p.locator('.toolbar'), '01/01/2026', '31/12/2026');
    r = await ui.readReport(p, { waitFor: no.xk });
    const nkRow = r.obj.find((x) => x['Số chứng từ'] === no.nk);
    expect(nkRow['Ngày hạch toán']).toBe('15/01/2026');
    expect(nkRow['Diễn giải']).toBe(`Nhập kho mua hàng ${SUP.name}`);
    expect(ui.vnNum(nkRow['Nhập'])).toBe(120);
    expect(ui.vnNum(r.obj.find((x) => x['Số chứng từ'] === no.xk)['Tồn'])).toBe(40);
    // báo cáo chi tiết mua hàng
    await ui.menu(p, 'Báo cáo');
    await p.getByRole('button', { name: /Chi tiết mua hàng/ }).click();
    await expect(p.getByRole('heading', { name: 'Chi tiết mua hàng' })).toBeVisible();
    await ui.setRange(p, p.locator('.toolbar'), '01/01/2026', '31/01/2026');
    r = await ui.readReport(p, { waitFor: no.nk });
    const line = r.rows.find((x) => x.includes('KT40'));
    expect(line).toContain('145.000');
    expect(line).toContain('17.400.000');
  });

  test('REQ-030 REQ-081 Sửa làm âm kho (SL nhập 120 → 50 khi đã bán 80) bị từ chối ngay khi gõ và khi lưu; không đổi gì', async () => {
    const p = hoa.page;
    await ui.menu(p, 'Mua hàng', 'Phiếu nhập');
    await p.getByRole('row', { name: new RegExp(no.nk) }).dblclick();
    await expect(p.locator('.doc-no')).toContainText(no.nk);
    await p.getByRole('button', { name: /Sửa phiếu/ }).click();
    await p.getByLabel('Số lượng dòng 1').click();
    await p.keyboard.type('50');
    await p.keyboard.press('Enter');
    // báo ngay khi gõ (hướng dẫn: "phần mềm báo ngay khi bạn gõ và không cho lưu")
    await expect(p.locator('.check-bad')).toContainText('Lưu thay đổi này sẽ làm thiếu hàng');
    await expect(p.locator('.check-bad')).toContainText('10/09/2026');
    await ui.shot(p, '07-sua-lam-am-kho');
    await p.keyboard.press('Control+s');
    const dlg = p.locator('.ant-modal-confirm').filter({ hasText: 'Không đủ hàng trong kho' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('KT40');
    await expect(dlg).toContainText('Phiếu đã ghi sổ chưa bị thay đổi');
    await dlg.getByRole('button', { name: 'Đã hiểu' }).click();
    await p.getByRole('button', { name: 'Hủy sửa' }).click();
    await p.locator('.ant-modal-confirm').getByRole('button', { name: 'Bỏ thay đổi' }).click();
    await expect(p.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
    const l = await ui.readLines(p);
    expect(ui.vnNum(l[0].qty)).toBe(120);
    expect((await api.stockOf(A.code)).total_stock).toBe(40);
    expect(await api.debtClosing('KIMTIN', 'payable')).toBe(27400000);
    const d = await api.docByNo(no.nk);
    expect(d.lines[0].qty).toBe(120);
  });

  test('REQ-003 Lịch sử phiếu (nút đồng hồ): ai lập, ai ghi sổ, ai sửa gì', async () => {
    const p = hoa.page;
    await p.getByRole('button', { name: 'Lịch sử sửa phiếu' }).click();
    const dr = p.locator('.ant-drawer-open').filter({ hasText: 'Lịch sử sửa phiếu' });
    await expect(dr).toBeVisible();
    await expect(dr).toContainText('Lập phiếu');
    await expect(dr).toContainText('Ghi sổ');
    await expect(dr).toContainText('Sửa phiếu');
    await expect(dr).toContainText('Nguyễn Thị Lan (Máy 1)');
    await expect(dr).toContainText('Trần Thị Hoa (Máy 2)');
    const txt = await dr.innerText();
    // nội dung thay đổi: SL 100 → 120 và giá 150.000 → 145.000 của KT40
    expect(txt).toMatch(/KT40[\s\S]*100[\s\S]*120/);
    expect(txt).toMatch(/150\.000[\s\S]*145\.000/);
    await ui.shot(p, '07-lich-su-sua-phieu');
    await p.keyboard.press('Escape');
    await expect(dr).toBeHidden();
  });

  test('REQ-037 REQ-038 REQ-039 Mở phiếu bán cũ, sửa SL 80 → 70 và đơn giá 195.000 → 190.000: công nợ khách và tồn tính lại', async () => {
    const p = lan.page;
    await ui.menu(p, 'Bán hàng', 'Phiếu bán');
    await p.getByPlaceholder('Số phiếu, tên đối tác, ghi chú…').fill('an phu');
    await p.getByRole('row', { name: new RegExp(no.xk) }).dblclick();
    await expect(p.locator('.doc-no')).toContainText(no.xk);
    await expect(p.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
    await p.keyboard.press('F8');
    await expect(p.getByText('ĐANG SỬA phiếu đã ghi sổ', { exact: true })).toBeVisible();
    await p.getByLabel('Số lượng dòng 1').click();
    await p.keyboard.type('70');
    await p.keyboard.press('Enter');
    await p.keyboard.type('190000');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Control+s');
    await ui.toast(p, new RegExp(`Đã lưu thay đổi phiếu ${no.xk}`));
    expect(await api.debtClosing('ANPHU', 'receivable')).toBe(70 * 190000);
    expect((await api.stockOf(A.code)).total_stock).toBe(50);
    // công nợ hiện trên màn hình phải thu
    await ui.menu(p, 'Công nợ', 'Phải thu khách hàng');
    const r = await ui.readReport(p, { waitFor: 'ANPHU' });
    expect(ui.vnNum(r.obj.find((x) => x['Mã'] === 'ANPHU')['Khách còn nợ'])).toBe(13300000);
  });
});
