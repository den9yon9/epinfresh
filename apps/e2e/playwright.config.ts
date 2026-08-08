import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    // ponytail: iPhone 13 默认 webkit, 只装了 chromium, 显式指回 chromium
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'bun --env-file=../../.env src/index.ts',
      cwd: '../storefront-api',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
    },
    {
      command: 'pnpm dev',
      cwd: '../storefront-web',
      // /@vite/client 在 proxy bypass 白名单内, 不会误入 API
      url: 'http://localhost:5173/@vite/client',
      reuseExistingServer: true,
    },
  ],
})
