// Câu chuyện 11 — Thu chi tiền mặt và ngân hàng (YEU_CAU mục 6, REQ-056…062, 085): nhiều dòng tiền cho cùng một khách
// và cùng một NCC trong một phiếu; công nợ và sổ quỹ / sổ ngân hàng chạy đúng; bản in có "Bằng chữ"; trường hợp hoàn
// tiền (NCC hoàn tiền cho mình, mình trả lại tiền khách).
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');
const { readXlsx, readDocx, findRow } = require('../lib/files');
const { printAndExports, comparable } = require('../lib/printcmp');

test.describe.configure({ mode: 'serial' });

const CUS = { code: 'PHUCTHINH', name: 'Công ty TNHH Cơ khí Phúc Thịnh', is_customer: true, opening_receivable: 20000000 };
const SUP = { code: 'HUNGTHINH', name: 'Công ty CP Vật tư Hưng Thịnh', is_supplier: true, opening_payable: 30000000 };

test.describe('Câu chuyện 11: thu chi nhiều dòng, tiền mặt và ngân hàng', () => {
  let page;
  let ctx;
  let api;
  const no = {};
  const cash0 = {};
  const files = {};
  test.beforeAll(async ({ browser }) => {
    api = await Api.login();
    await api.ensurePartner(CUS);
    await api.ensurePartner(SUP);
    await api.ensureCashOpening('TM', 50000000);
    await api.ensureCashOpening('NH', 200000000);
    for (const k of ['TM', 'NH']) {
      const a = await api.findByCode('cash-accounts', k);
      cash0[k] = { id: a.id, bal: (await api.get(`/reports/cash-book?account_id=${a.id}&to=2026-10-11`)).closing };
    }
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    ({ ctx, page } = await openAs(browser, 'hoa', 'hoa123456', 'hoa'));
  });
  test.afterAll(async () => ctx.close());

  test('REQ-056 REQ-060 REQ-062 Phiếu thu tiền mặt 3 dòng cho Phúc Thịnh: số PT, công nợ trước → sau, bằng chữ', async () => {
    await ui.enterVoucher(page, {
      type: 'receipt',
      account: 'TM',
      date: '12/10/2026',
      partner: 'phuc thinh',
      partnerName: CUS.name,
      note: 'Thu nợ đợt 1',
      lines: [
        { desc: 'Thu nợ cũ', amount: '5.000.000' },
        { desc: 'Thu tiền phiếu bán tháng 9', amount: '3205000' },
        { desc: 'Thu tiền cước xe', amount: '250k' },
      ],
      save: false,
    });
    await expect(page.locator('.acc-hint')).toContainText('PT…');
    await expect(page.locator('.doc-sums')).toContainText('8.455.000');
    await expect(page.locator('.debt-line')).toContainText('trước phiếu này 20.000.000 → sau phiếu này 11.545.000');
    await expect(page.locator('.money-words')).toHaveText('Bằng chữ: Tám triệu bốn trăm năm mươi lăm nghìn đồng');
    await ui.shot(page, '11-phieu-thu-nhieu-dong');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('ĐÃ LƯU — có hiệu lực', { exact: true })).toBeVisible();
    no.pt = (await page.locator('.doc-no b').first().innerText()).trim();
    expect(no.pt).toMatch(/^PT\d{5}$/);
    expect(await api.debtClosing('PHUCTHINH', 'receivable')).toBe(11545000);
  });

  test('REQ-085 Bản in phiếu thu (Ctrl+P, khổ A5): tiêu đề, 3 dòng, tổng và "Bằng chữ"', async () => {
    await ui.blurAll(page);
    await page.keyboard.press('Control+p');
    const dlg = page.getByRole('dialog', { name: 'Xem trước bản in (khổ A5)' });
    await expect(dlg.locator('.ps-title')).toHaveText('PHIẾU THU');
    await expect(dlg).toContainText(no.pt);
    await expect(dlg).toContainText(CUS.name);
    await expect(dlg).toContainText('Thu tiền phiếu bán tháng 9');
    await expect(dlg).toContainText('8.455.000');
    await expect(dlg).toContainText('Bằng chữ: Tám triệu bốn trăm năm mươi lăm nghìn đồng');
    await ui.shot(page, '11-ban-in-phieu-thu');
    await dlg.getByRole('button', { name: 'Đóng' }).click();
  });

  test('REQ-008 REQ-087 Xuất Excel/Word phiếu thu: bảng dòng tiền, số là số, "Tổng số tiền" = SUM, không khóa', async () => {
    const xf = await ui.exportDoc(page, 'xlsx', '11-phieu-thu.xlsx');
    files.xlsx = xf.file;
    const x = await readXlsx(xf.file);
    expect(x.isProtected).toBe(false);
    expect(findRow(x.rows, 'PHIẾU THU')).toBeGreaterThanOrEqual(0);
    const h = findRow(x.rows, 'Chứng từ liên quan');
    expect(x.rows[h].filter((v) => v !== null)).toEqual(['STT', 'Diễn giải', 'Chứng từ liên quan', 'Số tiền']);
    const col = x.rows[h].indexOf('Số tiền');
    const amounts = [1, 2, 3].map((i) => x.rows[h + i][col]);
    expect(amounts).toEqual([5000000, 3205000, 250000]);
    const si = findRow(x.rows, /^Tổng số tiền$/);
    expect(si).toBe(h + 4);
    expect(x.rows[si][col]).toBe(8455000);
    expect(x.cells[si][col].formula || x.cells[si][col].value.formula).toMatch(/SUM/i);
    files.docx = (await ui.exportDoc(page, 'docx', '11-phieu-thu.docx')).file;
    const d = await readDocx(files.docx);
    expect(d.isProtected).toBe(false);
    const t = d.tables.find((tb) => tb[0] && tb[0].includes('Diễn giải'));
    expect(t.slice(1, 4).map((r) => r[1])).toEqual(['Thu nợ cũ', 'Thu tiền phiếu bán tháng 9', 'Thu tiền cước xe']);
    expect(t[4][0]).toBe('Tổng số tiền');
    expect(t[4][t[4].length - 1]).toBe('8.455.000');
  });

  // F-02 (đã sửa, kiểm lại): file Excel/Word của phiếu thu có "Bằng chữ" và đúng y chữ đang hiện trên màn hình;
  // toàn bộ file khớp bản in (tiêu đề, số/ngày/quỹ, người nộp, lý do, bảng, Tổng số tiền, Bằng chữ, Kèm theo, 5 ô ký).
  test('REQ-085 REQ-087 File Excel/Word phiếu thu có "Bằng chữ" = chữ trên màn hình và khớp bản in', async () => {
    const screenWords = (await page.locator('.money-words').innerText()).replace(/\s+/g, ' ').trim();
    expect(screenWords).toBe('Bằng chữ: Tám triệu bốn trăm năm mươi lăm nghìn đồng');
    const x = await readXlsx(files.xlsx);
    expect(x.rows[findRow(x.rows, /^Bằng chữ:/)].find((v) => typeof v === 'string')).toBe(screenWords);
    const d = await readDocx(files.docx);
    expect(d.paragraphs).toContain(screenWords);
    const r = await printAndExports(page, '11-phieu-thu-so-khop');
    expect(r.print.words).toEqual([screenWords, 'Kèm theo: ……… chứng từ gốc.']);
    expect(r.print.signers).toEqual(['Giám đốc', 'Kế toán trưởng', 'Người nộp tiền', 'Người lập phiếu', 'Thủ quỹ']);
    expect(r.print.info).toEqual([`Họ tên người nộp tiền: ${CUS.name}`, 'Lý do nộp: Thu nợ đợt 1']);
    expect(comparable(r.xlsx)).toEqual(r.print);
    expect(comparable(r.docx)).toEqual(r.print);
  });

  test('REQ-085 Số tiền bằng chữ trên màn hình đúng quy tắc tiếng Việt (linh, mốt, lăm, bốn, không trăm, tỷ)', async () => {
    await ui.enterVoucher(page, { type: 'receipt', account: 'TM', date: '17/10/2026', lines: [{ desc: 'Kiểm tra bằng chữ', amount: '1' }], save: false });
    const amountCell = page.getByLabel('Số tiền dòng 1');
    const cases = [
      ['1.234.000', 'Một triệu hai trăm ba mươi bốn nghìn đồng'],
      ['24', 'Hai mươi bốn đồng'],
      ['21.000', 'Hai mươi mốt nghìn đồng'],
      ['105.000', 'Một trăm linh năm nghìn đồng'],
      ['15.000', 'Mười lăm nghìn đồng'],
      ['45.000', 'Bốn mươi lăm nghìn đồng'],
      ['1.005.000', 'Một triệu không trăm linh năm nghìn đồng'],
      ['10.000.000', 'Mười triệu đồng'],
      ['2.000.000.000', 'Hai tỷ đồng'],
    ];
    const wrong = [];
    for (const [amt, words] of cases) {
      await amountCell.fill(amt);
      const got = (await page.locator('.money-words').innerText()).replace(/^Bằng chữ:\s*/, '').trim();
      if (got !== words) wrong.push(`${amt}: "${got}" (mong đợi "${words}")`);
    }
    expect(wrong).toEqual([]);
    // phiếu thu khác (không đối tác) 1.234.000 — lưu, so file xuất với bản in và chữ trên màn hình
    await amountCell.fill('1.234.000');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('ĐÃ LƯU — có hiệu lực', { exact: true })).toBeVisible();
    const r = await printAndExports(page, '11-thu-khac-1234000');
    expect(r.print.words[0]).toBe('Bằng chữ: Một triệu hai trăm ba mươi bốn nghìn đồng');
    expect(r.print.info[0]).toMatch(/^Họ tên người nộp tiền: …+$/);
    expect(comparable(r.xlsx)).toEqual(r.print);
    expect(comparable(r.docx)).toEqual(r.print);
  });

  test('REQ-058 REQ-060 Thu qua ngân hàng (giấy báo có BC) 2 dòng cho cùng khách', async () => {
    no.bc = await ui.enterVoucher(page, {
      type: 'receipt',
      account: 'NH',
      date: '13/10/2026',
      partner: 'phuc thinh',
      partnerName: CUS.name,
      lines: [
        { desc: 'Khách chuyển khoản đợt 2', amount: '2000000' },
        { desc: 'Khách chuyển khoản bù', amount: '1015000' },
      ],
    });
    expect(no.bc).toMatch(/^BC\d{5}$/);
    await expect(page.locator('.money-words')).toHaveText('Bằng chữ: Ba triệu không trăm mười lăm nghìn đồng');
    const r = await printAndExports(page, '11-giay-bao-co');
    expect(r.print.title).toBe('GIẤY BÁO CÓ (THU QUA NGÂN HÀNG)');
    expect(r.print.account).toBe('Ngân hàng');
    expect(r.print.words[0]).toBe('Bằng chữ: Ba triệu không trăm mười lăm nghìn đồng');
    expect(comparable(r.xlsx)).toEqual(r.print);
    expect(comparable(r.docx)).toEqual(r.print);
    expect(await api.debtClosing('PHUCTHINH', 'receivable')).toBe(11545000 - 3015000);
  });

  test('REQ-057 REQ-059 REQ-061 REQ-062 Chi tiền mặt (PC) và chi ngân hàng (BN), mỗi phiếu 2 dòng cho cùng NCC', async () => {
    no.pc = await ui.enterVoucher(page, {
      type: 'payment',
      account: 'TM',
      date: '14/10/2026',
      partner: 'hung thinh',
      partnerName: SUP.name,
      lines: [
        { desc: 'Trả tiền hàng đợt 1', amount: '4000000' },
        { desc: 'Trả tiền hàng đợt 2', amount: '6000000' },
      ],
    });
    no.bn = await ui.enterVoucher(page, {
      type: 'payment',
      account: 'NH',
      date: '15/10/2026',
      partner: 'hung thinh',
      partnerName: SUP.name,
      lines: [
        { desc: 'Chuyển khoản trả nợ', amount: '7000000' },
        { desc: 'Chuyển khoản phí vận chuyển', amount: '3000000' },
      ],
    });
    expect([no.pc, no.bn].map((n) => n.slice(0, 2))).toEqual(['PC', 'BN']);
    await expect(page.locator('.money-words')).toHaveText('Bằng chữ: Mười triệu đồng');
    const r = await printAndExports(page, '11-giay-bao-no');
    expect(r.print.title).toBe('GIẤY BÁO NỢ (CHI QUA NGÂN HÀNG)');
    expect(r.print.signers).toEqual(['Giám đốc', 'Kế toán trưởng', 'Thủ quỹ', 'Người lập phiếu', 'Người nhận tiền']);
    expect(r.print.info[0]).toBe(`Họ tên người nhận tiền: ${SUP.name}`);
    expect(comparable(r.xlsx)).toEqual(r.print);
    expect(comparable(r.docx)).toEqual(r.print);
    expect(await api.debtClosing('HUNGTHINH', 'payable')).toBe(10000000);
  });

  test('REQ-007 REQ-062 Hoàn tiền: thu tiền của NCC (NCC hoàn tiền) ⇒ tăng lại phải trả; phần mềm hỏi rõ phiếu này là gì', async () => {
    await ui.enterVoucher(page, { type: 'receipt', account: 'TM', date: '16/10/2026', partner: 'hung thinh', partnerName: SUP.name, lines: [{ desc: 'NCC hoàn tiền hàng lỗi', amount: '500000' }], save: false });
    const choice = page.locator('.side-choice');
    await expect(choice).toContainText('Đối tác này là nhà cung cấp. Phiếu này là:');
    await expect(choice.getByRole('radio', { name: /Nhà cung cấp hoàn tiền cho mình — tăng lại số phải trả/ })).toBeChecked();
    await expect(page.locator('.debt-line')).toContainText('Công nợ phải trả');
    await expect(page.locator('.debt-line')).toContainText('trước phiếu này 10.000.000 → sau phiếu này 10.500.000');
    await ui.shot(page, '11-ncc-hoan-tien');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('ĐÃ LƯU — có hiệu lực', { exact: true })).toBeVisible();
    no.ptRefund = (await page.locator('.doc-no b').first().innerText()).trim();
    expect(await api.debtClosing('HUNGTHINH', 'payable')).toBe(10500000);
  });

  test('REQ-007 REQ-062 Hoàn tiền: chi trả lại tiền cho khách ⇒ tăng lại phải thu', async () => {
    await ui.enterVoucher(page, { type: 'payment', account: 'TM', date: '16/10/2026', partner: 'phuc thinh', partnerName: CUS.name, lines: [{ desc: 'Trả lại tiền khách chuyển dư', amount: '300000' }], save: false });
    await expect(page.locator('.side-choice').getByRole('radio', { name: /Trả lại tiền cho khách — tăng lại số phải thu/ })).toBeChecked();
    await expect(page.locator('.debt-line')).toContainText('trước phiếu này 8.530.000 → sau phiếu này 8.830.000');
    await page.keyboard.press('Control+s');
    await expect(page.getByText('ĐÃ LƯU — có hiệu lực', { exact: true })).toBeVisible();
    no.pcRefund = (await page.locator('.doc-no b').first().innerText()).trim();
    expect(await api.debtClosing('PHUCTHINH', 'receivable')).toBe(8830000);
  });

  test('REQ-056 REQ-057 Sổ quỹ tiền mặt: mỗi dòng tiền một dòng sổ, tồn lũy kế đúng; bấm dòng mở phiếu tại chỗ', async () => {
    await ui.menu(page, 'Quỹ & Ngân hàng', 'Sổ quỹ / Sổ ngân hàng');
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Tài khoản tiền' }), /^TM –/);
    await ui.setRange(page, page.locator('.toolbar'), '12/10/2026', '16/10/2026');
    const r = await ui.readReport(page, { waitFor: no.pcRefund });
    const opening = cash0.TM.bal;
    expect(r.rows[0]).toContain('Tồn đầu kỳ');
    expect(ui.vnNum(r.rows[0][r.rows[0].length - 1])).toBe(opening);
    const mine = r.obj.filter((x) => [no.pt, no.pc, no.ptRefund, no.pcRefund].includes(x['Số phiếu']));
    expect(mine.map((x) => x['Số phiếu'])).toEqual([no.pt, no.pt, no.pt, no.pc, no.pc, no.ptRefund, no.pcRefund]);
    // tồn lũy kế dòng cuối
    const expectedClose = opening + 8455000 - 10000000 + 500000 - 300000;
    expect(ui.vnNum(mine[mine.length - 1]['Tồn'])).toBe(expectedClose);
    await expect(page.locator('.debt-headline')).toContainText(`tồn cuối ${ui.money(expectedClose)} đ`);
    await ui.shot(page, '11-so-quy');
    await page.locator('.report-table .ant-table-tbody tr.ant-table-row').filter({ hasText: 'Trả tiền hàng đợt 2' }).click();
    await expect(ui.topDrawer(page)).toContainText(`Phiếu ${no.pc}`);
    await expect(ui.topDrawer(page)).toContainText('Bằng chữ: Mười triệu đồng');
    await page.keyboard.press('Escape');
  });

  test('REQ-058 REQ-059 Sổ ngân hàng: BC và BN với tồn lũy kế đúng', async () => {
    await ui.selectOption(page, page.getByRole('combobox', { name: 'Tài khoản tiền' }), /^NH –/);
    await expect(page.getByRole('heading', { name: 'Sổ tiền gửi ngân hàng' })).toBeVisible();
    const r = await ui.readReport(page, { waitFor: no.bn });
    const mine = r.obj.filter((x) => [no.bc, no.bn].includes(x['Số phiếu']));
    expect(mine.map((x) => [x['Số phiếu'], ui.vnNum(x['Thu']), ui.vnNum(x['Chi'])])).toEqual([
      [no.bc, 2000000, 0],
      [no.bc, 1015000, 0],
      [no.bn, 0, 7000000],
      [no.bn, 0, 3000000],
    ]);
    expect(ui.vnNum(mine[3]['Tồn'])).toBe(cash0.NH.bal + 3015000 - 10000000);
  });

  test('REQ-052 REQ-054 REQ-062 Tổng hợp công nợ cuối cùng khớp: Phúc Thịnh 8.830.000, Hưng Thịnh 10.500.000', async () => {
    await ui.menu(page, 'Công nợ', 'Phải thu khách hàng');
    let r = await ui.readReport(page, { waitFor: 'PHUCTHINH' });
    let row = r.obj.find((x) => x['Mã'] === 'PHUCTHINH');
    expect(['Đầu kỳ', 'Tăng', 'Giảm (đã thu)', 'Khách còn nợ'].map((k) => ui.vnNum(row[k]))).toEqual([20000000, 300000, 11470000, 8830000]);
    await ui.menu(page, 'Công nợ', 'Phải trả nhà cung cấp');
    r = await ui.readReport(page, { waitFor: 'HUNGTHINH' });
    row = r.obj.find((x) => x['Mã'] === 'HUNGTHINH');
    expect(['Đầu kỳ', 'Tăng', 'Giảm (đã trả)', 'Mình còn nợ'].map((k) => ui.vnNum(row[k]))).toEqual([30000000, 500000, 20000000, 10500000]);
    // sổ chi tiết ghi rõ phiếu ở phía ngược
    await page.getByRole('row', { name: /HUNGTHINH/ }).click();
    const led = await ui.readReport(ui.topDrawer(page), { waitFor: no.ptRefund });
    expect(led.obj.find((x) => x['Số chứng từ'] === no.ptRefund)['Diễn giải']).toContain('(nhà cung cấp hoàn tiền)');
    await page.keyboard.press('Escape');
  });
});
