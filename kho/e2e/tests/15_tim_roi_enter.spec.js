// Câu chuyện 15 — Kiểm lại F-05 / F-07 (vòng 2), F-11…F-15, F-17 (vòng 3): "gõ vài chữ rồi Enter" phải chọn ĐÚNG mục người dùng định chọn, trên mọi
// ô tìm (phiếu bán, phiếu nhập, phiếu thu, danh mục khách/NCC/hàng, danh sách phiếu, danh sách phiếu thu, thẻ kho),
// với nhiều tên, nhiều tốc độ gõ, có và không có độ trễ mạng; bộ nhớ đệm lạnh (lần đầu) và nóng (gõ lại tên đã tìm).
// Mỗi test gom mọi trường hợp sai rồi so một lần, để báo cáo thấy hết các trường hợp lệch.
const { test, expect, openAs } = require('../lib/fixtures');
const ui = require('../lib/ui');
const { Api } = require('../lib/api');

test.describe.configure({ mode: 'serial' });

const PARTNERS = [
  { code: 'ANBINH', name: 'Công ty TNHH An Bình', is_customer: true },
  { code: 'ANPHU', name: 'Cơ khí An Phú', is_customer: true },
  { code: 'APHUOC', name: 'Công ty An Phước', is_customer: true },
  { code: 'PHUAN', name: 'Cửa hàng Phú An', is_customer: true },
  { code: 'THANHCONG', name: 'Xưởng cơ khí Thành Công', is_customer: true, phone: '0909 444 555', opening_receivable: 2000000 },
  { code: 'TC2', name: 'Thành Công Mới', is_customer: true },
  { code: 'MPHUOC', name: 'Công ty Minh Phước', is_customer: true },
  { code: 'DLMP', name: 'Đại lý Minh Phú', is_customer: true },
  { code: 'MINHTAM', name: 'Công ty TNHH Xây dựng Minh Tâm', is_customer: true },
  { code: 'TANTHANH', name: 'Công ty TNHH Thép Tân Thành', is_supplier: true },
  { code: 'VIETHAN', name: 'Công ty TNHH Thiết bị hàn Việt – Hàn', is_supplier: true },
  { code: 'DAIVIET', name: 'Công ty CP Que hàn Đại Việt', is_supplier: true },
  { code: 'KIMTIN', name: 'Công ty CP Que hàn Kim Tín', is_supplier: true },
];
const PRODUCTS = [
  { code: 'KT40', name: 'Que hàn Kim Tín KT-421 4.0mm (5kg)', unit: 'Hộp', sale_price: 195000, purchase_price: 150000 },
  { code: 'KT32-5', name: 'Que hàn Kim Tín KT-421 3.2mm (5kg)', unit: 'Hộp', sale_price: 180000, purchase_price: 146000 },
  { code: 'CAP35', name: 'Dây cáp hàn 35mm² (cuộn 100m)', unit: 'Cuộn', sale_price: 3400000, purchase_price: 2900000 },
  { code: 'GL26', name: 'Que hàn inox GL-308 2.6mm (2kg)', unit: 'Hộp', sale_price: 260000, purchase_price: 200000 },
  { code: 'AA-MOI', name: 'Bàn chải sắt (mặt hàng đứng đầu danh sách)', unit: 'Cái', sale_price: 15000, purchase_price: 9000 },
];

// Tốc độ gõ (ms/phím), nhịp trước Enter (ms), độ trễ mạng giả lập (ms). 'dán' = gõ cả chuỗi một lần.
const SPEEDS = [
  { key: 20, gap: 0, lat: 0 },
  { key: 60, gap: 80, lat: 0 },
  { key: 60, gap: 80, lat: 600 },
  { key: 120, gap: 400, lat: 300 },
  { key: 'dán', gap: 0, lat: 600 },
];
const label = (s) => `gõ ${s.key === 'dán' ? 'dán' : `${s.key}ms/phím`}, Enter sau ${s.gap}ms, mạng trễ ${s.lat}ms`;

async function typeQuery(page, text, s) {
  if (s.key === 'dán') await page.keyboard.insertText(text);
  else await page.keyboard.type(text, { delay: s.key });
  if (s.gap) await page.waitForTimeout(s.gap); // nhịp tay của người (không phải chờ ứng dụng)
}
async function withLatency(page, re, lat, fn) {
  if (!lat) return fn();
  const h = async (route) => {
    await new Promise((r) => setTimeout(r, lat)); // độ trễ mạng giả lập
    await route.continue().catch(() => undefined); // yêu cầu có thể đã bị trình duyệt hủy (rời trang) trong lúc chờ
  };
  await page.route(re, h);
  try {
    return await fn();
  } finally {
    await page.unroute(re, h);
  }
}
/** Chờ tới khi đọc được kết quả (tối đa 4 s); trả giá trị cuối cùng đọc được. */
async function settle(read, want) {
  let last;
  await expect
    .poll(
      async () => {
        last = await read();
        return last;
      },
      { timeout: 4000 },
    )
    .toBe(want)
    .catch(() => undefined);
  return last;
}

test.describe('Câu chuyện 15: tìm rồi Enter trên mọi ô tìm', () => {
  let page;
  let ctx;
  const nos = {};
  test.beforeAll(async ({ browser }) => {
    const api = await Api.login();
    for (const p of PARTNERS) await api.ensurePartner(p);
    for (const p of PRODUCTS) await api.ensureProduct(p);
    const kho1 = await api.wh('KHO1');
    await api.openingStock('KHO1', '2026-01-01', PRODUCTS.map((p) => ({ product_code: p.code, qty: 100 })));
    const id = async (c) => (await api.findByCode('partners', c)).id;
    nos.sales = [];
    for (const c of ['ANBINH', 'ANPHU', 'PHUAN']) {
      nos.sales.push((await api.postedDoc({ doc_type: 'sale', doc_date: '2026-11-01', partner_id: await id(c), warehouse_id: kho1.id, lines: [{ product_code: 'GL26', qty: 1 }] })).doc_no);
    }
    const tm = await api.findByCode('cash-accounts', 'TM');
    nos.vouchers = [];
    for (const c of ['ANBINH', 'ANPHU', 'PHUAN']) {
      nos.vouchers.push((await api.post('/vouchers', { voucher_type: 'receipt', voucher_date: '2026-11-02', account_id: tm.id, partner_id: await id(c), lines: [{ description: `Thu nợ ${c}`, amount: 10000 }] })).voucher_no);
    }
    await api.ensureUser('hoa', 'Trần Thị Hoa (Máy 2)', 'hoa123456');
    ({ ctx, page } = await openAs(browser, 'hoa', 'hoa123456', 'hoa (tìm)'));
    page.on('dialog', (d) => d.accept()); // rời trang bằng goto khi phiếu đang có khách: chấp nhận "Rời khỏi trang?"
  });
  test.afterAll(async () => ctx.close());

  /** Rời phiếu đang mở theo cách của người dùng (menu → "Bỏ thay đổi, rời đi" nếu được hỏi) rồi mở trang mới. */
  async function leaveEditor() {
    if (/\/(chung-tu|phieu-thu-chi)\//.test(page.url())) {
      await page.getByRole('complementary').getByRole('link', { name: 'Tổng quan', exact: true }).click();
      const c = page.locator('.ant-modal-confirm').filter({ hasText: 'Phiếu chưa lưu' });
      await c.waitFor({ timeout: 1500 }).then(() => c.getByRole('button', { name: 'Bỏ thay đổi, rời đi' }).click(), () => undefined);
      await expect(page.locator('.crumb-title')).toHaveText('Tổng quan');
    }
  }
  async function freshPage(url) {
    await leaveEditor();
    await page.goto(url);
    await expect(page.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
  }

  /**
   * Ô chọn đối tác trong phiếu: mỗi lần gõ là một phiếu mới trên trang mới (bộ nhớ đệm lạnh, chưa chọn ai) — đúng
   * tình huống F-05 (kết quả cũ). Trường hợp đệm nóng / đổi khách đã chọn thuộc F-11, kiểm riêng bên dưới.
   */
  async function partnerMatrix(url, cases, apiRe) {
    const wrong = [];
    for (const s of SPEEDS) {
      for (const [q, want] of cases) {
        await freshPage(url);
        const got = await withLatency(page, apiRe, s.lat, async () => {
          await page.locator('#partner').focus();
          await typeQuery(page, q, s);
          await page.keyboard.press('Enter');
          return settle(async () => ((await page.locator('.hf-partner .ant-select-selection-item').innerText().catch(() => '')).split(' – ')[0] || '(chưa chọn)'), want);
        });
        if (got !== want) wrong.push(`"${q}" (${label(s)}) → ${got}, mong đợi ${want}`);
      }
    }
    return wrong;
  }

  test('REQ-025 F-05 Phiếu bán, ô Khách hàng: gõ tên/điện thoại rồi Enter chọn đúng khách (5 tốc độ × 4 tên)', async () => {
    const wrong = await partnerMatrix(
      '/chung-tu/moi?loai=sale',
      [['an phu', 'ANPHU'], ['thanh cong', 'THANHCONG'], ['phu an', 'PHUAN'], ['0909 444', 'THANHCONG']],
      /\/api\/partners\?/,
    );
    expect(wrong).toEqual([]);
  });

  test('REQ-023 F-05 F-07 Phiếu nhập, ô Nhà cung cấp: "viet han", "han viet" (thứ tự bất kỳ, bỏ dấu "–"), "tan thanh"', async () => {
    const wrong = await partnerMatrix(
      '/chung-tu/moi?loai=purchase',
      [['viet han', 'VIETHAN'], ['tan thanh', 'TANTHANH'], ['han viet', 'VIETHAN'], ['kim tin', 'KIMTIN']],
      /\/api\/partners\?/,
    );
    expect(wrong).toEqual([]);
  });

  test('REQ-060 F-05 F-07 Phiếu thu, ô Người nộp (mọi đối tác): "thanh cong" ra Thành Công trước Tân Thành; "an phu"; "tan thanh"', async () => {
    const wrong = await partnerMatrix(
      '/phieu-thu-chi/moi?loai=receipt',
      [['thanh cong', 'THANHCONG'], ['tan thanh', 'TANTHANH'], ['an phu', 'ANPHU']],
      /\/api\/partners\?/,
    );
    expect(wrong).toEqual([]);
  });

  /** Ô tìm của màn danh sách: Enter, Enter ⇒ mở dòng đầu; kiểm mở đúng mục. */
  async function listMatrix(menuArgs, cases, apiRe, openedName) {
    const wrong = [];
    await leaveEditor();
    for (const s of SPEEDS) {
      await ui.menu(page, ...menuArgs);
      await page.reload(); // bộ nhớ đệm lạnh cho mỗi tốc độ
      await expect(page.locator('.ant-table-tbody tr.ant-table-row').first()).toBeVisible();
      for (const [q, want] of cases) {
        const got = await withLatency(page, apiRe, s.lat, async () => {
          await ui.blurAll(page);
          await page.keyboard.press('/');
          await page.keyboard.press('Control+a');
          await typeQuery(page, q, s);
          await page.keyboard.press('Enter');
          if (s.gap) await page.waitForTimeout(s.gap);
          await page.keyboard.press('Enter');
          return settle(() => openedName(), want);
        });
        if (got !== want) wrong.push(`"${q}" (${label(s)}) → ${got}, mong đợi ${want}`);
        // đóng thứ đã mở để làm lần sau
        const dlg = page.getByRole('dialog').filter({ hasText: /^Sửa / });
        if (await dlg.isVisible()) {
          await expect(dlg.locator('input').first()).toBeFocused();
          await page.keyboard.press('Escape');
          await expect(dlg).toBeHidden();
        }
      }
    }
    return wrong;
  }
  const dialogCode = async () => {
    const t = await page.locator('.ant-modal-title').filter({ hasText: /^Sửa / }).first().innerText().catch(() => '');
    return t ? t.split(' ').pop() : '(không mở gì)';
  };

  test('REQ-UX F-05 Danh mục Khách hàng: gõ rồi Enter, Enter mở đúng khách (5 tốc độ, có trễ mạng)', async () => {
    const wrong = await listMatrix(['Danh mục', 'Khách hàng'], [['thanh cong', 'THANHCONG'], ['an phu', 'ANPHU'], ['phu an', 'PHUAN'], ['thanh cong', 'THANHCONG']], /\/api\/partners\?/, dialogCode);
    expect(wrong).toEqual([]);
  });

  test('REQ-UX F-05 Danh mục Nhà cung cấp: "viet han", "tan thanh" rồi Enter, Enter', async () => {
    const wrong = await listMatrix(['Danh mục', 'Nhà cung cấp'], [['viet han', 'VIETHAN'], ['tan thanh', 'TANTHANH']], /\/api\/partners\?/, dialogCode);
    expect(wrong).toEqual([]);
  });

  test('REQ-UX F-05 Danh mục Hàng hóa: gõ mã rồi Enter, Enter mở đúng mặt hàng', async () => {
    const wrong = await listMatrix(['Danh mục', 'Hàng hóa, dịch vụ'], [['KT40', 'KT40'], ['CAP35', 'CAP35'], ['GL26', 'GL26']], /\/api\/products\?/, dialogCode);
    expect(wrong).toEqual([]);
  });

  /** Danh sách phiếu: gõ/dán số phiếu rồi Enter, Enter. Trả {wrong: mở NHẦM phiếu, missed: không mở gì}. */
  async function docListMatrix(menuArgs, numbers, apiRe, urlRe) {
    const out = { wrong: [], missed: [], total: 0 };
    const speeds = [...SPEEDS, SPEEDS[4], SPEEDS[4]]; // trường hợp dán + mạng chậm làm 3 lần
    for (const s of speeds) {
      for (const no of numbers) {
        await leaveEditor();
        await ui.menu(page, ...menuArgs);
        await expect(page.locator('.ant-table-tbody tr.ant-table-row').first()).toBeVisible();
        const got = await withLatency(page, apiRe, s.lat, async () => {
          await ui.blurAll(page);
          await page.keyboard.press('F3');
          await typeQuery(page, no, s);
          await page.keyboard.press('Enter');
          if (s.gap) await page.waitForTimeout(s.gap);
          await page.keyboard.press('Enter');
          return settle(async () => (urlRe.test(page.url()) ? (await page.locator('.doc-no b').first().innerText().catch(() => '?')).trim() : '(không mở gì)'), no);
        });
        out.total++;
        if (got === '(không mở gì)') out.missed.push(`"${no}" (${label(s)})`);
        else if (got !== no) out.wrong.push(`"${no}" (${label(s)}) → mở nhầm ${got}`);
      }
    }
    return out;
  }
  const listRes = {};

  test('REQ-037 F-05 Danh sách Phiếu bán: gõ/dán số phiếu rồi Enter, Enter — KHÔNG BAO GIỜ mở nhầm phiếu', async () => {
    listRes.docs = await docListMatrix(['Bán hàng', 'Phiếu bán'], nos.sales, /\/api\/documents\?/, /\/chung-tu\/\d+/);
    expect(listRes.docs.wrong).toEqual([]);
  });

  test('REQ-060 F-05 Danh sách Phiếu thu: gõ/dán số phiếu rồi Enter, Enter — KHÔNG BAO GIỜ mở nhầm phiếu', async () => {
    listRes.vouchers = await docListMatrix(['Quỹ & Ngân hàng', 'Thu tiền'], nos.vouchers, /\/api\/vouchers\?/, /\/phieu-thu-chi\/\d+/);
    expect(listRes.vouchers.wrong).toEqual([]);
  });

  // F-15 (vòng 2: dán số phiếu rồi Enter, Enter khi mạng chậm thường không mở gì) — ĐÃ SỬA ở vòng 3, kiểm lại nghiêm: mỗi
  // trường hợp dán + mạng chậm làm 3 lần, không lần nào được trượt.
  test('REQ-037 REQ-060 F-15 Danh sách Phiếu bán / Phiếu thu: Enter, Enter luôn mở được phiếu vừa gõ/dán (mọi tốc độ, mạng chậm)', async () => {
    const missed = [...listRes.docs.missed, ...listRes.vouchers.missed];
    expect(missed, `${missed.length}/${listRes.docs.total + listRes.vouchers.total} lần không mở`).toEqual([]);
  });

  const stockCardPick = async () =>
    ((await page.locator('.toolbar .ant-select').first().locator('.ant-select-selection-item').textContent().catch(() => '')) || '(chưa chọn)').split(' – ')[0];

  test('REQ-012 F-05 Thẻ kho, ô chọn mặt hàng: gõ mã rồi Enter chọn đúng mã (mỗi lần trang mới)', async () => {
    const wrong = [];
    await leaveEditor();
    for (const s of SPEEDS) {
      for (const [q, want] of [['KT40', 'KT40'], ['GL26', 'GL26'], ['CAP35', 'CAP35']]) {
        await page.goto('/kho/the-kho');
        const combo = page.locator('.toolbar .ant-select').first().getByRole('combobox');
        await expect(combo).toBeVisible();
        const got = await withLatency(page, /\/api\/products\?/, s.lat, async () => {
          await combo.focus();
          await typeQuery(page, q, s);
          await page.keyboard.press('Enter');
          return settle(stockCardPick, want);
        });
        if (got !== want) wrong.push(`"${q}" (${label(s)}) → ${got}, mong đợi ${want}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('REQ-025 Ô Mã hàng trong lưới phiếu: gõ mã/tên rồi Enter lấy đúng mã kể cả mạng chậm', async () => {
    const wrong = [];
    for (const s of SPEEDS) {
      await freshPage('/chung-tu/moi?loai=sale');
      for (const [q, want] of [['KT40', 'KT40'], ['kim tin 4.0', 'KT40'], ['GL26', 'GL26']]) {
        const got = await withLatency(page, /\/api\/products/, s.lat, async () => {
          await ui.focusBlankCode(page);
          await typeQuery(page, q, s);
          await page.keyboard.press('Enter');
          const r = await settle(async () => {
            const ls = await ui.readLines(page);
            return ls.length ? ls[ls.length - 1].code : '(chưa lấy)';
          }, want);
          return r;
        });
        if (got !== want) wrong.push(`"${q}" (${label(s)}) → ${got}, mong đợi ${want}`);
        // về lại ô mã của dòng trống
        await page.keyboard.press('Escape');
      }
    }
    expect(wrong).toEqual([]);
  });

  const partnerPick = async () => ((await page.locator('.hf-partner .ant-select-selection-item').innerText().catch(() => '')) || '(chưa chọn)').split(' – ')[0];
  const optCode = (t) => t.trim().split(/\n| – /)[0].trim();
  const openOpts = () => page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');

  // F-12 (vòng 2: "minh phu" chọn "Minh Phước") — ĐÃ SỬA ở vòng 3 (khớp nguyên từ xếp trên khớp một phần). Kiểm cả thứ tự
  // gợi ý lẫn mục được chọn, ở cả gõ chậm và dán.
  test('REQ-025 F-12 Gõ đủ từ "minh phu" rồi Enter chọn "Đại lý Minh Phú" (khớp nguyên từ) chứ không phải "Minh Phước"', async () => {
    const res = [];
    for (const how of ['gõ', 'dán']) {
      await freshPage('/chung-tu/moi?loai=sale');
      await page.locator('#partner').focus();
      if (how === 'gõ') await page.keyboard.type('minh phu', { delay: 60 });
      else await page.keyboard.insertText('minh phu');
      await expect(page.locator('[data-search-pending]')).toHaveCount(0);
      const first = optCode(await openOpts().first().innerText());
      await page.keyboard.press('Enter');
      res.push(`${how}: đầu danh sách ${first}, chọn ${await settle(partnerPick, 'DLMP')}`);
    }
    await ui.shot(page, 'F12-minh-phu-chon-minh-phu');
    expect(res).toEqual(['gõ: đầu danh sách DLMP, chọn DLMP', 'dán: đầu danh sách DLMP, chọn DLMP']);
  });

  // F-11 (b) (vòng 2: danh mục chỉ có một khách ⇒ Enter không chọn gì) — ĐÃ SỬA ở vòng 3. Giả lập "chỉ có một khách" bằng
  // cách trả danh sách ban đầu (chưa gõ gì) đúng bằng kết quả tìm — máy chủ thật trả y như vậy khi danh mục chỉ có một khách.
  test('REQ-018 REQ-UX F-11 Danh mục chỉ có một khách: bán cho khách rồi lập Khách trả hàng, gõ "minh tam", Enter chọn khách và sang ô Kho', async () => {
    const api = await Api.login();
    const only = await api.get('/partners?q=minh%20tam&type=customer&active=true&page_size=30');
    expect(only.items.map((x) => x.code)).toEqual(['MINHTAM']);
    const one = async (route) => {
      const u = new URL(route.request().url());
      if (u.searchParams.get('q')) return route.continue();
      return route.fulfill({ json: only });
    };
    await leaveEditor();
    await page.route(/\/api\/partners\?/, one);
    try {
      await page.goto('/chung-tu/moi?loai=sale');
      await expect(page.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
      await ui.pickPartner(page, 'minh tam', 'Xây dựng Minh Tâm');
      await ui.focusBlankCode(page);
      await ui.typeLine(page, { code: 'GL26', qty: 1 });
      await ui.saveDraft(page);
      await ui.menu(page, 'Bán hàng', 'Khách trả hàng');
      await ui.newDocByF2(page, /^Khách trả hàng/);
      await page.locator('#partner').focus();
      await page.keyboard.type('minh tam', { delay: 40 });
      await expect(page.locator('[data-search-pending]')).toHaveCount(0);
      await expect(openOpts().first()).toContainText('Xây dựng Minh Tâm');
      await page.waitForTimeout(500); // người dùng nhìn danh sách rồi mới Enter
      await page.keyboard.press('Enter');
      await expect.poll(partnerPick).toBe('MINHTAM');
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('warehouse');
      await ui.shot(page, 'F11-mot-khach-enter-chon');
    } finally {
      await page.unroute(/\/api\/partners\?/, one);
    }
  });

  // F-11 (a) (vòng 2, nặng: đổi khách đã chọn bằng gõ + Enter vẫn giữ khách cũ vì khách cũ bị ghim đầu gợi ý) — ĐÃ SỬA ở
  // vòng 3. Kiểm thêm theo quyết định của vòng 3: khi đang gõ, danh sách KHÔNG có mục đang chọn; ↓ rồi Enter nhận đúng mục
  // đã dời tới; gõ chữ không có kết quả rồi Enter ⇒ chữ gõ còn nguyên, lựa chọn cũ không đổi.
  test('REQ-025 REQ-UX F-11 Đổi khách / mặt hàng đã chọn: gõ tên mới, đợi danh sách hiện, Enter ⇒ nhận mục mới (phiếu bán 3/3, thẻ kho)', async () => {
    const res = [];
    for (let i = 0; i < 3; i++) {
      await freshPage('/chung-tu/moi?loai=sale');
      await ui.pickPartner(page, 'an phu', 'Cơ khí An Phú');
      // chọn xong con trỏ tự sang ô Kho (sau một nhịp) — chờ như người dùng thấy rồi mới quay lại ô Khách
      await expect(page.locator('#warehouse')).toBeFocused();
      await page.locator('#partner').focus();
      await page.keyboard.type('thanh cong', { delay: 60 });
      await expect(page.locator('[data-search-pending]')).toHaveCount(0);
      await expect(openOpts().filter({ hasText: 'Xưởng cơ khí Thành Công' })).toBeVisible();
      const shown = (await openOpts().allInnerTexts()).map(optCode);
      expect(shown, 'đang gõ thì không ghim khách đang chọn (ANPHU)').not.toContain('ANPHU');
      await page.keyboard.press('Enter');
      res.push(await settle(partnerPick, 'THANHCONG'));
    }
    // ↓ dời mục sáng xuống mục thứ hai rồi Enter ⇒ nhận đúng mục thứ hai
    await freshPage('/chung-tu/moi?loai=sale');
    await ui.pickPartner(page, 'an phu', 'Cơ khí An Phú');
    await expect(page.locator('#warehouse')).toBeFocused();
    await page.locator('#partner').focus();
    await page.keyboard.type('thanh cong', { delay: 60 });
    await expect(page.locator('[data-search-pending]')).toHaveCount(0);
    const second = optCode(await openOpts().nth(1).innerText());
    expect(second).not.toBe('THANHCONG');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active')).toContainText(second);
    await page.keyboard.press('Enter');
    res.push(`↓: ${await settle(partnerPick, second)}`);
    // không có kết quả ⇒ chữ gõ còn nguyên, khách không đổi
    await page.locator('#partner').focus();
    await page.keyboard.type('zzqx khong co', { delay: 30 });
    await expect(page.locator('[data-search-pending]')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800); // để mọi xử lý sau Enter chạy xong rồi mới đọc
    const typed = await page.locator('#partner').inputValue();
    await ui.shot(page, 'F11-khong-ket-qua-giu-chu');
    // (khi ô còn chữ gõ, antd ẩn mục đang chọn; Esc bỏ chữ gõ rồi mới đọc được khách đang chọn)
    await page.keyboard.press('Escape');
    await expect(page.locator('#partner')).toHaveValue('');
    res.push(`không kết quả: ${await partnerPick()}, chữ "${typed}"`);
    await ui.shot(page, 'F11-doi-khach');
    // ô chọn mặt hàng của Thẻ kho: đã chọn KT40, gõ GL26, đợi danh sách, Enter
    await leaveEditor();
    await page.goto('/kho/the-kho');
    const combo = page.locator('.toolbar .ant-select').first().getByRole('combobox');
    await combo.focus();
    await page.keyboard.type('KT40', { delay: 60 });
    await expect(page.locator('[data-search-pending]')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect.poll(stockCardPick).toBe('KT40');
    await page.keyboard.press('Escape'); // F-17: danh sách còn mở sau khi chọn
    await combo.focus();
    await page.keyboard.type('GL26', { delay: 60 });
    await expect(page.locator('[data-search-pending]')).toHaveCount(0);
    await expect(openOpts().filter({ hasText: 'GL26' })).toBeVisible();
    await page.keyboard.press('Enter');
    res.push(await settle(stockCardPick, 'GL26'));
    expect(res).toEqual(['THANHCONG', 'THANHCONG', 'THANHCONG', `↓: ${second}`, `không kết quả: ${second}, chữ "zzqx khong co"`, 'GL26']);
  });

  // PHÁT HIỆN F-17 (BAO_CAO_E2E.md, vòng 3): ô chọn mặt hàng ở bộ lọc (Thẻ kho, Lịch sử bán theo mặt hàng): gõ mã rồi Enter
  // chọn đúng, nhưng danh sách gợi ý KHÔNG đóng — nó hiện lại toàn bộ danh mục, che bảng kết quả, mục đầu ("DV – Dịch vụ" /
  // "AA-MOI") được tô sáng; Enter thêm lần nữa (thói quen "Enter, Enter") đổi lựa chọn sang mục đầu đó. Mã nguồn có ghi ý
  // định "đóng danh sách" (searchGuard) nhưng thực tế không đóng. Trước vòng 3 danh sách đóng sau Enter.
  test.fail('REQ-012 REQ-021 REQ-UX F-17 Ô chọn mặt hàng ở bộ lọc: Enter chọn xong thì danh sách đóng; Enter lần nữa không đổi lựa chọn', async () => {
    const res = {};
    await leaveEditor();
    // Thẻ kho
    await page.goto('/kho/the-kho');
    let combo = page.locator('.toolbar .ant-select').first().getByRole('combobox');
    await combo.focus();
    await page.keyboard.type('GL26', { delay: 40 });
    await expect(page.locator('[data-search-pending]')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect.poll(stockCardPick).toBe('GL26');
    await page.waitForTimeout(800); // người dùng nhìn kết quả
    res['thẻ kho: danh sách còn mở'] = await openOpts().count() > 0;
    await ui.shot(page, 'F17-the-kho-danh-sach-con-mo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    res['thẻ kho: sau Enter thứ hai'] = await stockCardPick();
    // Lịch sử bán theo mặt hàng
    await ui.menu(page, 'Báo cáo');
    await page.getByRole('button', { name: /Lịch sử bán theo mặt hàng/ }).click();
    await expect(page.getByRole('heading', { name: 'Lịch sử bán hàng theo mặt hàng' })).toBeVisible();
    const sel = page.locator('.toolbar .ant-select').nth(2);
    combo = sel.getByRole('combobox');
    await combo.focus();
    await page.keyboard.type('GL26', { delay: 40 });
    await expect(page.locator('[data-search-pending]')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(sel.locator('.ant-select-selection-item')).toContainText('GL26');
    await page.waitForTimeout(800);
    res['lịch sử bán: danh sách còn mở'] = await openOpts().count() > 0;
    await ui.shot(page, 'F17-lich-su-ban-danh-sach-con-mo');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    res['lịch sử bán: sau Enter thứ hai'] = ((await sel.locator('.ant-select-selection-item').innerText().catch(() => '')) || '(chưa chọn)').split(' – ')[0];
    await page.keyboard.press('Escape');
    expect(res).toEqual({
      'thẻ kho: danh sách còn mở': false,
      'thẻ kho: sau Enter thứ hai': 'GL26',
      'lịch sử bán: danh sách còn mở': false,
      'lịch sử bán: sau Enter thứ hai': 'GL26',
    });
  });

  // F-14 (vòng 2: tải lại trang thì báo sai "phiên đăng nhập trước bị ngắt") — ĐÃ SỬA ở vòng 3: tải lại trang báo đúng câu
  // "từ lần mở trước", không nhắc tới phiên đăng nhập. (Trường hợp phiên hết thật được kiểm ở tests/14, F-04.)
  test('REQ-UX F-14 Tải lại trang khi đang gõ phiếu: báo "Đã khôi phục … từ lần mở trước", không nhắc phiên đăng nhập', async () => {
    await freshPage('/chung-tu/moi?loai=sale');
    await ui.pickPartner(page, 'an phu', 'Cơ khí An Phú');
    await ui.focusBlankCode(page);
    await ui.typeLine(page, { code: 'GL26', qty: 2 });
    await page.reload(); // hộp "rời trang?" của trình duyệt được chấp nhận (page.on('dialog'))
    await expect(page.getByText('PHIẾU MỚI — chưa lưu', { exact: true })).toBeVisible();
    await expect(page.locator('.ant-message-notice').filter({ hasText: /khôi phục/ })).toBeVisible();
    const notes = await page.locator('.ant-message-notice').allInnerTexts();
    await ui.shot(page, 'F14-tai-lai-trang');
    expect(notes.map((t) => t.trim()).filter((t) => /khôi phục|[Pp]hiên/.test(t))).toEqual(['Đã khôi phục các dòng đang gõ dở từ lần mở trước — kiểm tra rồi bấm Lưu.']);
    expect((await ui.readLines(page)).map((l) => `${l.code}:${l.qty}`)).toEqual(['GL26:2']);
    await expect.poll(partnerPick).toBe('ANPHU');
  });

  // F-13 (vòng 2: tìm mặt hàng nhiều từ ngoài lưới phiếu không ra gì) — ĐÃ SỬA ở vòng 3: tách theo khoảng trắng, thứ tự bất kỳ.
  // Không chỉ "có kết quả": mọi dòng phải chứa đủ các từ, và mặt hàng mong đợi phải có mặt.
  test('REQ-012 REQ-020 F-13 Tìm mặt hàng nhiều từ ở Danh mục hàng hóa, Thẻ kho, Tồn kho ("que 3.2", "3.2 que", "cap 35", "kim tin 4.0")', async () => {
    const fold = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
    const bad = [];
    const allHave = (q, rows) => rows.length > 0 && rows.every((r) => fold(q).split(/\s+/).every((t) => fold(r).includes(t)));
    const check = (where, q, rows, want) => {
      const toks = fold(q).split(/\s+/);
      if (!rows.some((r) => r.includes(want))) bad.push(`${where} "${q}": thiếu ${want} (${rows.length} dòng)`);
      for (const r of rows) if (!toks.every((t) => fold(r).includes(t))) bad.push(`${where} "${q}": dòng không đủ từ: ${r.slice(0, 60)}`);
    };
    const CASES = [['que 3.2', 'KT32-5'], ['3.2 que', 'KT32-5'], ['cap 35', 'CAP35'], ['35 cap', 'CAP35'], ['kim tin 4.0', 'KT40']];
    await leaveEditor();
    await ui.menu(page, 'Danh mục', 'Hàng hóa, dịch vụ');
    const catRows = page.locator('.ant-table-tbody tr.ant-table-row');
    for (const [q, want] of CASES) {
      await page.getByPlaceholder(/Tìm mã, tên hàng/).fill(q);
      await expect.poll(async () => allHave(q, await catRows.allInnerTexts()), { timeout: 4000 }).toBe(true).catch(() => undefined); // lọc xong
      check('danh mục', q, await catRows.allInnerTexts(), want);
    }
    await ui.menu(page, 'Kho', 'Tồn kho');
    const stRows = page.locator('.report-table .ant-table-tbody tr.ant-table-row');
    for (const [q, want] of CASES) {
      await page.getByPlaceholder('Tìm mã, tên hàng…').fill(q);
      await expect.poll(async () => allHave(q, await stRows.allInnerTexts()), { timeout: 4000 }).toBe(true).catch(() => undefined); // lọc xong
      check('tồn kho', q, await stRows.allInnerTexts(), want);
    }
    for (const [q, want] of CASES) {
      await page.goto('/kho/the-kho');
      const combo = page.locator('.toolbar .ant-select').first().getByRole('combobox');
      await combo.focus();
      await page.keyboard.type(q, { delay: 30 });
      await expect(page.locator('[data-search-pending]')).toHaveCount(0);
      check('thẻ kho', q, await openOpts().allInnerTexts(), want);
      if (q === 'kim tin 4.0') {
        await page.keyboard.press('Enter');
        if ((await settle(stockCardPick, 'KT40')) !== 'KT40') bad.push('thẻ kho "kim tin 4.0" Enter không chọn KT40');
      }
      await page.keyboard.press('Escape');
    }
    expect(bad).toEqual([]);
  });

  // Vòng 3 (quyết định của nhóm): ngày gõ NGAY sau khi mở phiếu thu/chi hay phiếu kho phải được giữ (vòng 2 ghi nhận: gõ
  // ngày ~0,1 s sau khi mở phiếu thu thì đôi khi ngày bị đặt lại). Mỗi loại làm 3 lần, không chờ con trỏ hay dữ liệu tải xong.
  test('REQ-060 REQ-025 Ngày gõ ngay khi vừa mở phiếu thu / phiếu chi / phiếu bán được giữ nguyên', async () => {
    const res = [];
    const dates = ['03/11/2026', '04/11/2026', '05/11/2026'];
    for (const [url, sel] of [
      ['/phieu-thu-chi/moi?loai=receipt', '#voucher_date'],
      ['/phieu-thu-chi/moi?loai=payment', '#voucher_date'],
      ['/chung-tu/moi?loai=sale', '#doc_date'],
    ]) {
      for (const date of dates) {
        await leaveEditor();
        await page.goto(url);
        const d = page.locator(sel);
        await d.click(); // ngay khi ô ngày hiện ra
        await page.keyboard.press('Control+A');
        await page.keyboard.type(date, { delay: 15 });
        await page.keyboard.press('Tab');
        await page.waitForTimeout(1500); // phiếu tải xong hết mọi thứ
        res.push(`${url} ${date} → ${await d.inputValue()}`);
      }
    }
    await ui.shot(page, 'ngay-go-ngay-khi-mo-phieu');
    await leaveEditor();
    expect(res).toEqual(
      ['/phieu-thu-chi/moi?loai=receipt', '/phieu-thu-chi/moi?loai=payment', '/chung-tu/moi?loai=sale'].flatMap((u) => dates.map((dt) => `${u} ${dt} → ${dt}`)),
    );
  });
});
