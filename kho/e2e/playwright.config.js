// Cấu hình Playwright cho bộ kiểm thử nghiệm thu đầu-cuối.
// Chạy tuần tự (1 worker): các câu chuyện dùng chung một CSDL mới tạo cho mỗi lần chạy (run.sh).
const { defineConfig } = require('playwright/test');
const { BASE_URL, OUT } = require('./lib/env');

module.exports = defineConfig({
  testDir: './tests',
  outputDir: `${OUT}/test-results`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: `${OUT}/ket-qua.json` }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1366, height: 768 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
});
