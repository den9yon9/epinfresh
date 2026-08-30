import { expect, type Page, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

// 完整支付链路: storefront 下单支付 → admin 退款 → 断言支付/退款记录。
// 在 mobile/desktop 项目(5173)运行, admin 端用绝对 URL(5174)访问。
const ADMIN_BASE = 'http://localhost:5174'
const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'admin123456'

async function registerAndLogin(page: Page): Promise<void> {
  const suffix = Date.now()
  await page.goto('/register')
  await page.getByLabel('昵称').fill('支付链路用户')
  await page.getByLabel('邮箱').fill(`pay-${suffix}@example.com`)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page).toHaveURL(/\/\?page=1$/)
}

async function orderAndPay(page: Page): Promise<string> {
  // 加购
  await page.goto('/')
  await page.getByText('有机番茄').first().click()
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已加入购物车')).toBeVisible()

  // 建地址
  await page.goto('/addresses/new')
  await page.getByLabel('收件人').fill('支付链路')
  await page.getByLabel('手机号').fill('13500135000')
  await page.getByLabel('详细地址').fill('上海市浦东新区支付链路 1 号')
  await page.getByLabel('设为默认地址').check()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page).toHaveURL(/\/addresses$/)

  // 结算下单
  await page.goto('/checkout')
  await page.getByRole('button', { name: '提交订单' }).click()
  await expect(page).toHaveURL(/\/pay\?orderId=[0-9a-f-]{36}$/)
  const payUrl = page.url()
  const orderId = /orderId=([0-9a-f-]{36})/.exec(payUrl)?.[1]
  if (!orderId) throw new Error('failed to capture order id')

  // 发起支付 → mock 模拟完成 → 支付成功
  await page.getByRole('button', { name: '确认支付' }).click()
  await expect(page.getByAltText('支付二维码')).toBeVisible()
  await page.getByRole('button', { name: '模拟支付完成' }).click()
  await expect(page.getByText('支付成功', { exact: true })).toBeVisible()

  return orderId
}

async function adminLogin(page: Page): Promise<void> {
  await page.goto(`${ADMIN_BASE}/login`)
  await page.getByLabel('邮箱').fill(ADMIN_EMAIL)
  await page.getByLabel('密码').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('下单支付 → admin 退款 → 订单与退款记录联动', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)

  // 1. storefront: 下单并支付
  await registerAndLogin(page)
  const orderId = await orderAndPay(page)

  // 2. admin: 退款
  await adminLogin(page)
  await page.goto(`${ADMIN_BASE}/orders/${orderId}`)
  await expect(page.getByRole('heading', { name: '订单详情' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /支付记录/ })).toBeVisible()

  // 支付记录渠道显示"模拟"
  await expect(page.getByText('模拟')).toBeVisible()

  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '退款' }).click()
  await expect(page.getByRole('heading', { name: /退款记录/ })).toBeVisible()
  await expect(page.getByText('已退款').first()).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})

test('下单支付 → admin 发货 → 确认收货 → 已完成', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)

  // 1. storefront: 下单并支付
  await registerAndLogin(page)
  const orderId = await orderAndPay(page)

  // 2. admin: 发货(独立 context——localhost 各端口共享 cookie jar,
  //    复用同一 page 会让 admin session 覆盖 storefront 会话导致 401)
  const adminContext = await page.context().browser()!.newContext()
  const adminPage = await adminContext.newPage()
  await adminLogin(adminPage)
  await adminPage.goto(`${ADMIN_BASE}/orders/${orderId}`)
  await adminPage.getByRole('button', { name: '发货', exact: true }).click()
  await adminPage.getByPlaceholder('运单号（可选）').fill('SF000111222')
  await adminPage.getByRole('button', { name: '确认发货' }).click()
  await expect(adminPage.getByText('已发货').first()).toBeVisible()
  await adminContext.close()

  // 3. storefront: 确认收货 → 已完成
  await page.goto(`/orders/${orderId}`)
  await expect(page.getByText('运单号：SF000111222')).toBeVisible()
  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '确认收货' }).click()
  await expect(page.getByText('已完成').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '确认收货' })).toHaveCount(0)

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})

test('wechat oauth routes are wired in the storefront api', async ({ request }) => {
  // mock 环境下未授权: openid 为 null(端点存在即验证路由已注册)
  const res = await request.get('http://localhost:3000/auth/wechat/openid')
  expect(res.status()).toBe(200)
  const data = await res.json()
  expect(data.openid).toBeNull()
})
