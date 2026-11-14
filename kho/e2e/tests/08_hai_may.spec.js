// Câu chuyện 8 — Hai máy (YEU_CAU mục 4 cuối, REQ-040…045, 082): máy 1 lên phiếu tạm; máy 2 thấy ngay trong
// "Phiếu tạm đang treo" mà không tải lại trang, mở, thêm dòng; máy 1 thấy thay đổi; hai máy sửa cùng lúc ⇒
// báo xung đột, không mất dòng đang gõ; máy 2 ghi sổ. Hai ngữ cảnh trình duyệt riêng, hai kế toán khác nhau.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');

test.describe.configure({ mode: 'serial' });

const CUS = { code: 'HOANGLONG', name: 'Cửa hàng VLXD Hoàng Long', is_customer: true, phone: '0918 222 333' };
const PRODUCTS = [
  { code: 'MATNA', name: 'Mặt nạ hàn tự động', unit: 'Cái', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 350000, purchase_price: 250000 },
  { code: 'GANGTAY', name: 'Găng tay hàn da', unit: 'Đôi', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 45000, purchase_price: 30000 },
  { code: 'BUAGO', name: 'Búa gõ xỉ hàn', unit: 'Cái', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 35000, purchase_price: 22000 },
];

const linesOf = async (page) => (await ui.readLines(page)).map((l) => `${l.code}:${ui.vnNum(l.qty)}`);

test.describe('Câu chuyện 8: hai máy cùng làm một phiếu tạm', () => {
  let m1; // Nguyễn Thị Lan (Máy 1)
  let m2; // Trần Thị Hoa (Máy 2)
  let tam;
  let docUrl;
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    await api.ensurePartner(CUS);
    for (const p of PRODUCTS) await api.ensureProduct(p);
    await api.openingStock('KHO1', '2026-01-01', PRODUCTS.map((p) => ({ product_code: p.code, qty: 50 })));
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    m1 = await openAs(browser, 'lan', 'lan123456', 'máy 1 (lan)');
    m2 = await openAs(browser, 'hoa', 'hoa123456', 'máy 2 (hoa)');
  });
  test.afterAll(async () => {
    await m1.ctx.close();
    await m2.ctx.close();
  });

  test('REQ-040 REQ-042 REQ-043 REQ-082 Máy 1 lưu phiếu tạm; máy 2 đang mở "Phiếu tạm đang treo" thấy ngay, không tải lại trang', async () => {
    await ui.menu(m2.page, 'Bán hàng', 'Phiếu tạm đang treo');
    await expect(m2.page.getByRole('heading', { name: /Phiếu tạm/ })).toBeVisible();
    await m2.page.evaluate(() => (window.__chuaTaiLai = true));

    tam = await ui.enterDoc(m1.page, { type: 'sale', partner: 'hoang long', partnerName: CUS.name, wh: 'KHO1', lines: [{ code: 'MATNA', qty: 2 }], action: 'save' });
    docUrl = m1.page.url();

    const row = m2.page.getByRole('row', { name: new RegExp(tam) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText(CUS.name);
    await expect(row).toContainText('Nguyễn Thị Lan (Máy 1)');
    expect(await m2.page.evaluate(() => window.__chuaTaiLai)).toBe(true);
    await ui.shot(m2.page, '08-may2-thay-phieu-tam');
  });

  test('REQ-044 REQ-082 Máy 2 mở phiếu của máy 1, thêm dòng, lưu; máy 1 (chưa sửa gì) tự hiện bản mới', async () => {
    await m2.page.getByRole('row', { name: new RegExp(tam) }).dblclick();
    await expect(m2.page).toHaveURL(docUrl);
    await expect(m2.page.locator('.doc-meta')).toContainText('Lập: Nguyễn Thị Lan (Máy 1)');
    // con trỏ tự vào ô mã của dòng trống cuối để gõ tiếp
    await expect(m2.page.locator('input.code-input').last()).toBeFocused();
    await ui.typeLine(m2.page, { code: 'GANGTAY', qty: 10 });
    await ui.saveDraft(m2.page);

    await ui.toast(m1.page, /Phiếu vừa được Trần Thị Hoa \(Máy 2\) cập nhật lúc .* — đã hiện bản mới nhất/);
    await expect.poll(() => linesOf(m1.page)).toEqual(['MATNA:2', 'GANGTAY:10']);
    await expect(m1.page.locator('.doc-meta')).toContainText('Sửa lần cuối: Trần Thị Hoa (Máy 2)');
    await ui.shot(m1.page, '08-may1-thay-thay-doi');
  });

  test('REQ-044 REQ-082 Hai máy sửa cùng lúc: máy 1 đang gõ thì được báo "Phiếu vừa được … sửa", chữ đang gõ không bị xóa', async () => {
    // máy 1 bắt đầu gõ thêm dòng (chưa lưu)
    await ui.focusBlankCode(m1.page);
    await ui.typeLine(m1.page, { code: 'BUAGO', qty: 5 });
    await expect(m1.page.getByText('Có thay đổi chưa lưu')).toBeVisible();
    // máy 2 sửa SL găng tay 10 → 12 và lưu
    await m2.page.getByLabel('Số lượng dòng 2').click();
    await m2.page.keyboard.type('12');
    await m2.page.keyboard.press('Enter');
    await ui.saveDraft(m2.page);
    // máy 1: cảnh báo, dòng đang gõ vẫn còn
    const warn = m1.page.locator('.doc-alert').filter({ hasText: 'Phiếu vừa được Trần Thị Hoa (Máy 2) sửa lúc' });
    await expect(warn).toBeVisible({ timeout: 10_000 });
    await expect(warn).toContainText('Bạn đang có thay đổi chưa lưu trên máy này');
    expect(await linesOf(m1.page)).toEqual(['MATNA:2', 'GANGTAY:10', 'BUAGO:5']);
    await ui.shot(m1.page, '08-may1-canh-bao-dang-sua');
  });

  test('REQ-082 Máy 1 vẫn bấm Ctrl+S: báo "Máy khác vừa sửa phiếu này", không ghi đè; Tải bản mới giữ dòng đã gõ trong khung vàng', async () => {
    await m1.page.keyboard.press('Control+s');
    const dlg = m1.page.locator('.ant-modal-confirm').filter({ hasText: 'Máy khác vừa sửa phiếu này' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Trần Thị Hoa (Máy 2)');
    await expect(dlg).toContainText('chưa được lưu');
    await ui.shot(m1.page, '08-xung-dot');
    await dlg.getByRole('button', { name: 'Tải bản mới' }).click();
    // bản mới nhất của máy 2
    await expect.poll(() => linesOf(m1.page)).toEqual(['MATNA:2', 'GANGTAY:12']);
    const stash = m1.page.locator('.doc-alert').filter({ hasText: 'Các dòng bạn đã nhập trước khi tải bản mới' });
    await expect(stash).toBeVisible();
    await expect(stash).toContainText('BUAGO');
    await expect(stash).toContainText('Búa gõ xỉ hàn');
    await ui.shot(m1.page, '08-khung-vang-dong-da-go');
    // máy chủ không bị ghi đè: vẫn là bản của máy 2
    const api = await Api.login();
    const d = await api.docByNo(tam);
    expect(d.lines.map((l) => `${l.product_code}:${l.qty}`)).toEqual(['MATNA:2', 'GANGTAY:12']);
  });

  // PHÁT HIỆN F-01 (BAO_CAO_E2E.md): khung vàng giữ TẤT CẢ các dòng của máy 1 (cả những dòng cũ đã có trên phiếu),
  // và nút "Thêm các dòng này vào phiếu" thêm lại tất cả ⇒ phiếu bị lặp dòng (MATNA 2 lần, GANGTAY 10 + 12).
  // Hướng dẫn sử dụng nói "Các dòng bạn vừa gõ vẫn giữ trong khung vàng để thêm lại".
  test.fail('REQ-082 "Thêm các dòng này vào phiếu" chỉ thêm dòng máy 1 vừa gõ (BUAGO), không lặp dòng', async () => {
    const stash = m1.page.locator('.doc-alert').filter({ hasText: 'Các dòng bạn đã nhập trước khi tải bản mới' });
    const stashText = await stash.innerText();
    await stash.getByRole('button', { name: 'Thêm các dòng này vào phiếu' }).click();
    const got = await linesOf(m1.page);
    await ui.shot(m1.page, 'F01-them-lai-dong-bi-lap');
    expect({ khungVang: stashText.includes('MATNA') ? 'có cả dòng cũ' : 'chỉ dòng mới', phieu: got }).toEqual({
      khungVang: 'chỉ dòng mới',
      phieu: ['MATNA:2', 'GANGTAY:12', 'BUAGO:5'],
    });
  });

  test('REQ-044 Máy 1 sửa lại cho đúng (bỏ dòng lặp nếu có) rồi lưu: phiếu có đủ 3 dòng', async () => {
    const p = m1.page;
    // xóa các dòng lặp bằng Ctrl+Delete (phím tắt có ghi trên màn hình)
    for (;;) {
      const got = await linesOf(p);
      const seen = new Set();
      const dupIdx = got.findIndex((x) => {
        const code = x.split(':')[0];
        if (seen.has(code)) return true;
        seen.add(code);
        return false;
      });
      if (dupIdx < 0) break;
      await p.locator('.line-grid tbody tr').nth(dupIdx).locator('input.code-input').click();
      await p.keyboard.press('Control+Delete');
      await expect.poll(() => linesOf(p).then((l) => l.length)).toBe(got.length - 1);
    }
    if (!(await linesOf(p)).some((x) => x.startsWith('BUAGO'))) {
      await ui.focusBlankCode(p);
      await ui.typeLine(p, { code: 'BUAGO', qty: 5 });
    }
    expect(await linesOf(p)).toEqual(['MATNA:2', 'GANGTAY:12', 'BUAGO:5']);
    await ui.saveDraft(p);
    await expect.poll(() => linesOf(m2.page), { timeout: 10_000 }).toEqual(['MATNA:2', 'GANGTAY:12', 'BUAGO:5']);
  });

  test('REQ-045 REQ-082 Máy 2 chốt phiếu (F9 ghi sổ); máy 1 thấy phiếu đã ghi sổ, phiếu rời khỏi danh sách treo', async () => {
    const xk = await ui.postDoc(m2.page);
    await expect(m1.page.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(m1.page.locator('.doc-no b').first()).toHaveText(xk);
    await expect(m1.page.locator('.doc-meta')).toContainText('Ghi sổ: Trần Thị Hoa (Máy 2)');
    await ui.menu(m1.page, 'Bán hàng', 'Phiếu tạm đang treo');
    await expect(m1.page.getByRole('row', { name: new RegExp(tam) })).toHaveCount(0);
    expect(await new Api((await Api.login()).token).debtClosing('HOANGLONG', 'receivable')).toBe(2 * 350000 + 12 * 45000 + 5 * 35000);
  });
});
