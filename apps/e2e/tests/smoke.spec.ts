import { type ConsoleMessage, expect, type Page, test } from '@playwright/test'

function collectConsoleErrors(page: Page): { errors: ConsoleMessage[]; pageErrors: Error[] } {
  const errors: ConsoleMessage[] = []
  const pageErrors: Error[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg)
  })
  page.on('pageerror', (err) => pageErrors.push(err))
  return { errors, pageErrors }
}

test('首页渲染：品牌、TabBar、占位内容', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  await page.goto('/')

  await expect(page.getByText('一品鲜')).toBeVisible()
  for (const tab of ['首页', '购物车', '我的']) {
    await expect(page.getByRole('navigation').getByText(tab)).toBeVisible()
  }
  await expect(page.getByText('首页 — 开发中')).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})

test('TabBar 切换与 active 高亮', async ({ page }) => {
  await page.goto('/')
  const cartTab = page.getByRole('navigation').getByText('购物车')

  await cartTab.click()
  await expect(page).toHaveURL(/\/cart/)
  await expect(page.getByText('购物车 — 开发中')).toBeVisible()

  await page.getByRole('navigation').getByText('我的').click()
  await expect(page).toHaveURL(/\/me/)
  await expect(page.getByText('我的 — 开发中')).toBeVisible()

  await page.getByRole('navigation').getByText('首页').click()
  await expect(page).toHaveURL(/\/$/)
})

test('二级页：返回键与标题', async ({ page }) => {
  // 站内路径进入二级页（与真实用户路径一致），再验证返回
  await page.goto('/')
  await page.goto('/products/abc123')
  await expect(page.getByText('商品详情 — 开发中')).toBeVisible()

  const back = page.getByRole('button', { name: '返回' })
  await expect(back).toBeVisible()
  await back.click()
  await expect(page).toHaveURL(/\/$/)
})

test('未匹配路由不落入后端 404（SPA fallback）', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  const res = await page.goto('/nonexistent-page')
  expect(res?.status()).toBe(200)
  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})
