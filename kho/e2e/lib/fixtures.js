// Fixture chung: mọi trang trình duyệt được theo dõi lỗi console, lỗi JS chưa bắt và phản hồi 5xx.
// Mọi sự cố ghi vào out/browser-issues.jsonl; tests/99_* kiểm tra tổng hợp cuối lần chạy.
const fs = require('fs');
const path = require('path');
const base = require('playwright/test');
const { OUT, BASE_URL } = require('./env');

const ISSUES = path.join(OUT, 'browser-issues.jsonl');
fs.mkdirSync(OUT, { recursive: true });

let currentTitle = '';

function record(kind, text, url, machine) {
  fs.appendFileSync(ISSUES, JSON.stringify({ at: new Date().toISOString(), test: currentTitle, machine, kind, text, url }) + '\n');
}

/** Gắn bộ theo dõi vào một trang (dùng cho trang tạo thêm, vd. máy 2). */
function monitor(page, machine = 'máy 1') {
  page.on('console', (m) => {
    if (m.type() === 'error') record('console', m.text(), m.location()?.url ?? '', machine);
  });
  page.on('pageerror', (e) => record('pageerror', String(e && e.stack ? e.stack : e), page.url(), machine));
  page.on('response', (r) => {
    if (r.status() >= 500) record('http5xx', `${r.status()} ${r.request().method()}`, r.url(), machine);
  });
  return page;
}

const test = base.test.extend({
  _title: [
    async ({}, use, testInfo) => {
      currentTitle = testInfo.titlePath.slice(1).join(' › ');
      await use();
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    monitor(page);
    await use(page);
  },
});

/** Tạo "máy" thứ hai: một ngữ cảnh trình duyệt riêng (cookie riêng), có theo dõi lỗi. */
async function newMachine(browser, name) {
  const ctx = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1366, height: 768 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  monitor(page, name);
  return { ctx, page };
}

/** Mở một "máy" và đăng nhập (dùng trong beforeAll của các câu chuyện chạy tuần tự). */
async function openAs(browser, username, password, name = username) {
  const { ctx, page } = await newMachine(browser, name);
  await require('./ui').login(page, username, password);
  return { ctx, page };
}

module.exports = { test, expect: base.expect, monitor, newMachine, openAs, ISSUES };
