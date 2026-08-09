import { type ConsoleMessage, expect, type Page, test } from '@playwright/test'

// 依赖 dev 库种子数据: db:seed 的 admin 账号 + 至少一笔订单
const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'admin123456'

function collectConsoleErrors(page: Page): { errors: ConsoleMessage[]; pageErrors: Error[] } {
  const errors: ConsoleMessage[] = []
  const pageErrors: Error[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg)
  })
  page.on('pageerror', (err) => pageErrors.push(err))
  return { errors, pageErrors }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('邮箱').fill(ADMIN_EMAIL)
  await page.getByLabel('密码').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('登录 → 仪表盘 → 订单列表 → 详情页导航', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)

  await login(page)
  await expect(page.getByText('快捷入口')).toBeVisible()

  await page.getByRole('navigation').getByText('订单').click()
  await expect(page).toHaveURL(/\/orders(\?page=1)?$/)
  await expect(page.getByRole('button', { name: '全部' })).toBeVisible()

  const viewLink = page.getByRole('link', { name: '查看' }).first()
  await expect(viewLink).toBeVisible()
  await viewLink.click()

  // 回归点: 详情页必须真实渲染 (此前 URL 跳转但 UI 停留在列表页)
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await expect(page.getByText('订单详情', { exact: true })).toBeVisible()
  await expect(page.getByText(/支付记录/)).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})

test('未登录访问受保护页面被重定向到登录页', async ({ page }) => {
  await page.goto('/orders')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})

test('商品新建: 表单提交后出现在列表', async ({ page }) => {
  await login(page)

  await page.getByRole('navigation').getByText('商品').click()
  await expect(page).toHaveURL(/\/products(\?page=1)?$/)
  await page.getByRole('link', { name: '新建商品' }).click()
  await expect(page).toHaveURL(/\/products\/new/)

  const suffix = Date.now()
  await page.getByLabel('名称').first().fill('E2E 商品')
  await page.getByLabel('Slug').fill(`e2e-prod-${suffix}`)
  await page.getByLabel('名称').nth(1).fill('1kg')
  await page.getByLabel('SKU 编码').fill(`E2E-${suffix}`)
  await page.getByLabel('价格（元）').fill('19.9')
  await page.getByRole('button', { name: '创建商品' }).click()

  await expect(page).toHaveURL(/\/products(\?page=1)?$/)
  await expect(page.getByText('E2E 商品').first()).toBeVisible()
})
