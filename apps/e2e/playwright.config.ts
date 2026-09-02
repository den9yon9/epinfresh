import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // 60s: 覆盖 CI 冷启动首次注册/下单的余量(此前 30s 偶发超时 flake)
  timeout: 60_000,
  expect: {
    // expect 断言默认 5s, 并行项目叠加注册/登录压力时偶发超时, 放宽到 10s
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    // ponytail: iPhone 13 默认 webkit, 只装了 chromium, 显式指回 chromium
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
      // payment.spec 走完整支付链路(含 admin 登录), 只在 desktop 跑一次, 降低共享认证限流压力
      testIgnore: [/admin\.spec\.ts/, /payment\.spec\.ts/],
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /admin\.spec\.ts/ },
    // admin 前后端: 独立 baseURL + 独立 spec
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5174' },
      testMatch: /admin\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // AUTH_RATE_LIMIT_PER_MINUTE=40: e2e 并行 3 项目共享 IP, 放宽认证限流(生产默认 20)
      command: 'AUTH_RATE_LIMIT_PER_MINUTE=40 bun --env-file=../../.env src/index.ts',
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
    {
      command: 'AUTH_RATE_LIMIT_PER_MINUTE=40 bun --env-file=../../.env src/index.ts',
      cwd: '../admin-api',
      url: 'http://localhost:3001/health',
      reuseExistingServer: true,
    },
    {
      command: 'pnpm dev',
      cwd: '../admin-web',
      url: 'http://localhost:5174/@vite/client',
      reuseExistingServer: true,
    },
    {
      // worker(含物流轮询): mock 轨迹 0 分钟签收 + 2s 轮询, 让 e2e 能观察到签收自动完成;
      // 行内 env 优先于 --env-file(bun 不覆盖已存在的进程变量)。HEALTH_PORT 供就绪探测。
      command:
        'LOGISTICS_MOCK_DELIVER_AFTER_MINUTES=0 LOGISTICS_POLL_INTERVAL_MS=2000 HEALTH_PORT=3100 bun --env-file=../../.env src/index.ts',
      cwd: '../worker',
      url: 'http://localhost:3100/health',
      reuseExistingServer: true,
    },
  ],
})
