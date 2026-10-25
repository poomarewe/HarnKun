import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/browser.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.QA_CHROMIUM_PATH ? { executablePath: process.env.QA_CHROMIUM_PATH } : {},
  },
  webServer: process.env.QA_EXTERNAL_SERVER ? undefined : {
    command: 'node server.js',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    env: { PORT: '4174', NODE_ENV: 'production', DOTENV_CONFIG_PATH: 'qa-no-env', DATABASE_URL: '', TYPHOON_OCR_API_KEY: '', ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: '' },
  },
});
