import { expect, type Page, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

async function registerAndLogin(page: Page): Promise<void> {
  const suffix = Date.now()
  await page.goto('/register')
  await page.getByLabel('昵称').fill('订单用户')
  await page.getByLabel('邮箱').fill(`orders-${suffix}@example.com`)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page).toHaveURL(/\/\?page=1$/)
}

test('未登录访问订单列表被重定向到登录页', async ({ page }) => {
  await page.goto('/orders')
  await expect(page).toHaveURL(/\/login/)
})

test('下单 → 订单列表 → 详情 → 取消订单', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  await registerAndLogin(page)

  // 加购 + 建地址 + 下单(不支付, 保持 pending 可取消)
  await page.goto('/')
  await page.getByText('有机番茄').first().click()
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已加入购物车')).toBeVisible()

  await page.goto('/addresses/new')
  await page.getByLabel('收件人').fill('王五')
  await page.getByLabel('手机号').fill('13600136000')
  await page.getByLabel('详细地址').fill('广州市天河区体育西路 1 号')
  await page.getByLabel('设为默认地址').check()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page).toHaveURL(/\/addresses$/)

  await page.goto('/checkout')
  await page.getByRole('button', { name: '提交订单' }).click()
  await expect(page).toHaveURL(/\/pay\?orderId=/)

  // 订单列表: 显示待支付订单(筛选 chips 与徽章同文, 用 link 内的徽章定位)
  await page.goto('/orders')
  await expect(page.getByRole('link', { name: /待支付/ })).toBeVisible()
  await expect(page.getByText('王五')).toBeVisible()

  // 详情页: 商品清单 + 取消按钮
  await page.getByText('王五').click()
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await expect(page.getByText('有机番茄', { exact: true })).toBeVisible()
  await expect(page.getByText('收货信息')).toBeVisible()

  // 取消订单
  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '取消订单' }).click()
  await expect(page.getByText('已取消')).toBeVisible()
  await expect(page.getByRole('button', { name: '取消订单' })).toHaveCount(0)

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})
