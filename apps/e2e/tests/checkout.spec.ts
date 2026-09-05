import { expect, type Page, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

async function registerAndLogin(page: Page): Promise<void> {
  const suffix = Date.now()
  await page.goto('/register')
  await page.getByLabel('昵称').fill('结算用户')
  await page.getByLabel('邮箱').fill(`checkout-${suffix}@example.com`)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page).toHaveURL(/\/\?page=1$/)
}

test('未登录访问结算页被重定向到登录页', async ({ page }) => {
  await page.goto('/checkout')
  await expect(page).toHaveURL(/\/login/)
})

test('空购物车访问结算页显示空态', async ({ page }) => {
  await registerAndLogin(page)
  await page.goto('/checkout')
  await expect(page.getByText('购物车是空的，先去挑点东西吧')).toBeVisible()
})

test('加购 → 建地址 → 结算下单 → 跳转支付页', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  await registerAndLogin(page)

  // 加购
  await page.goto('/')
  await page.getByText('有机番茄').first().click()
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已加入购物车')).toBeVisible()

  // 建地址
  await page.goto('/addresses/new')
  await page.getByLabel('收件人').fill('李四')
  await page.getByLabel('手机号').fill('13700137000')
  await page.getByLabel('省 / 直辖市').fill('上海市')
  await page.getByLabel('城市').fill('上海市')
  await page.getByLabel('详细地址').fill('北京市朝阳区望京街 8 号')
  await page.getByLabel('设为默认地址').check()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page).toHaveURL(/\/addresses$/)

  // 结算: 默认地址自动选中, 提交订单
  await page.goto('/checkout')
  await expect(page.getByText('李四')).toBeVisible()
  await expect(page.getByText('有机番茄', { exact: true })).toBeVisible()
  const submit = page.getByRole('button', { name: '提交订单' })
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(page).toHaveURL(/\/pay\?orderId=[0-9a-f-]{36}$/)
  await expect(page.getByRole('button', { name: '确认支付' })).toBeVisible()

  // 发起支付 → 展示二维码 → mock 模拟扫码完成, 成功页金额与应付一致
  const total = await page
    .getByText(/^¥\d+\.\d{2}$/)
    .last()
    .textContent()
  await page.getByRole('button', { name: '确认支付' }).click()
  await expect(page.getByAltText('支付二维码')).toBeVisible()
  await page.getByRole('button', { name: '模拟支付完成' }).click()
  await expect(page.getByText('支付成功', { exact: true })).toBeVisible()
  await expect(page.getByText(total!, { exact: true }).first()).toBeVisible()

  // 进入订单详情: 支付记录区显示已支付 (订单徽章与支付徽章同文案, 取第一个)
  await page.getByRole('link', { name: '查看订单' }).click()
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await expect(page.getByText('支付记录')).toBeVisible()
  await expect(page.getByText('已支付').first()).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})
