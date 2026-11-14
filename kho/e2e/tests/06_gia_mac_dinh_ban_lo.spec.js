// Câu chuyện 6 — Giá bán mặc định tự điền và sửa được; cảnh báo bán lỗ so với GIÁ NHẬP MUA GẦN NHẤT (SPEC R4),
// không chặn, khi ghi sổ phải xác nhận "Vẫn ghi sổ".
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { KISWEL } = require('../lib/data');

test.describe.configure({ mode: 'serial' });

const P = { code: 'KINHHAN', name: 'Kính hàn đen', unit: 'Cái', group_code: 'PK', group_name: 'Phụ kiện hàn', sale_price: 12000, purchase_price: 9000 };
const KL = { code: 'KHACHLE', name: 'Khách lẻ', is_customer: true };

test.describe('Câu chuyện 6: giá mặc định, sửa giá, cảnh báo bán lỗ', () => {
  let page;
  let ctx;
  let api;
  test.beforeAll(async ({ browser }) => {
    api = await Api.login();
    await api.ensureProduct(P);
    await api.ensurePartner(KL);
    await api.ensurePartner(KISWEL);
    await api.openingStock('KHO2', '2026-01-01', [{ product_code: P.code, qty: 200 }]);
    // lần nhập mua gần nhất: 01/06/2026 giá 10.000 (cao hơn giá mua trong danh mục 9.000)
    const kho2 = await api.wh('KHO2');
    const sup = await api.findByCode('partners', 'KISWEL');
    await api.postedDoc({ doc_type: 'purchase', doc_date: '2026-06-01', partner_id: sup.id, warehouse_id: kho2.id, lines: [{ product_code: P.code, qty: 50, unit_price: 10000 }] });
    await api.ensureUser('lan', 'Nguyễn Thị Lan (Máy 1)', 'lan123456');
    ({ ctx, page } = await openAs(browser, 'lan', 'lan123456', 'lan'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-026 REQ-027 Đơn giá tự điền 12.000 theo danh mục; gõ đè 15.000 cho khách khác giá', async () => {
    await ui.enterDoc(page, {
      type: 'sale',
      date: '20/10/2026',
      partner: 'khach le',
      partnerName: 'Khách lẻ',
      wh: 'KHO2',
      lines: [
        { code: P.code, qty: 10 },
        { code: P.code, qty: 5, price: '15.000' },
      ],
      action: 'none',
    });
    const l = await ui.readLines(page);
    expect([l[0].price, l[0].amount]).toEqual(['12.000', '120.000']);
    expect([l[1].price, l[1].amount]).toEqual(['15.000', '75.000']);
    // giá vốn so sánh hiện dưới đơn giá: giá nhập mua gần nhất 10.000 (không phải 9.000 trong danh mục)
    await expect(page.locator('.line-grid tbody tr').first()).toContainText('giá mua 10.000');
  });

  test('REQ-004 REQ-028 REQ-029 REQ-080 Giá 9.500 < giá nhập gần nhất 10.000 ⇒ dòng đỏ "Bán lỗ: giá mua 10.000"', async () => {
    await ui.typeLine(page, { code: P.code, qty: 5, price: '9.500' });
    const row = page.locator('.line-grid tbody tr').nth(2);
    await expect(row).toHaveClass(/row-loss/);
    await expect(row).toContainText('Bán lỗ: giá mua 10.000');
    await expect(page.locator('.line-grid tbody tr.row-loss')).toHaveCount(1);
    await ui.shot(page, '06-canh-bao-ban-lo');
  });

  test('REQ-028 Đổi ngày phiếu về 15/05/2026 (trước lần nhập 01/06) ⇒ giá vốn là giá danh mục 9.000, hết cảnh báo', async () => {
    await ui.setDocDate(page, '15/05/2026');
    await expect(page.locator('.line-grid tbody tr.row-loss')).toHaveCount(0);
    await expect(page.locator('.line-grid tbody tr').first()).toContainText('giá mua 9.000');
    await ui.setDocDate(page, '20/10/2026');
    await expect(page.locator('.line-grid tbody tr.row-loss')).toHaveCount(1);
  });

  test('REQ-029 REQ-080 F9: hỏi lại; "Xem lại giá" không ghi sổ; F9 lần nữa → "Vẫn ghi sổ" thì ghi sổ', async () => {
    await page.keyboard.press('F9');
    let dlg = page.locator('.ant-modal-confirm').filter({ hasText: 'Có dòng bán thấp hơn giá mua (bán lỗ)' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Dòng 3 (KINHHAN): giá bán 9.500 thấp hơn giá mua 10.000 — bán lỗ');
    await ui.shot(page, '06-xac-nhan-ban-lo');
    await dlg.getByRole('button', { name: 'Xem lại giá' }).click();
    await expect(dlg).toBeHidden();
    await expect(page.getByText('PHIẾU TẠM — chưa ghi sổ', { exact: true })).toBeVisible();
    await page.keyboard.press('F9');
    dlg = page.locator('.ant-modal-confirm').filter({ hasText: 'Có dòng bán thấp hơn giá mua (bán lỗ)' });
    await dlg.getByRole('button', { name: 'Vẫn ghi sổ' }).click();
    await expect(page.getByText('ĐÃ GHI SỔ', { exact: true })).toBeVisible();
    const no = (await page.locator('.doc-no b').first().innerText()).trim();
    const d = await api.docByNo(no);
    expect(d.lines.map((x) => x.unit_price)).toEqual([12000, 15000, 9500]);
    expect(d.total_amount).toBe(120000 + 75000 + 47500);
  });
});
