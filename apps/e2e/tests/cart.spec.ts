import { expect, type Page, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

async function registerAndLogin(page: Page): Promise<string> {
  const suffix = Date.now()
  const email = `cart-${suffix}@example.com`
  await page.goto('/register')
  await page.getByLabel('昵称').fill('购物车用户')
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page).toHaveURL(/\/\?page=1$/)
  return email
}

test('未登录访问购物车被重定向到登录页', async ({ page }) => {
  await page.goto('/cart')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})

test('加购 → 购物车改数量 → 删除 → 空车态', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  await registerAndLogin(page)

  // 首页进商品详情并加购
  await page.goto('/')
  await page.getByText('有机番茄').first().click()
  await expect(page).toHaveURL(/\/products\//)
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page.getByText('已加入购物车')).toBeVisible()

  // 购物车展示条目与单价(详情页无 TabBar, 直接访问)
  await page.goto('/cart')
  await expect(page).toHaveURL(/\/cart/)
  await expect(page.getByText('有机番茄', { exact: true })).toBeVisible()

  const unitText = await page
    .getByText(/^¥\d+\.\d{2}$/)
    .first()
    .textContent()
  const unit = Number(unitText!.replace('¥', ''))
  await expect(page.getByText(`¥${unit.toFixed(2)}`).last()).toBeVisible()

  // 加数量 → 合计翻倍
  await page.getByRole('button', { name: '增加数量' }).click()
  await expect(page.getByText(`¥${(unit * 2).toFixed(2)}`).last()).toBeVisible()

  // 删除 → 空车态
  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('购物车是空的')).toBeVisible()
  await expect(page.getByRole('link', { name: '去逛逛' })).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})
