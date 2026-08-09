import { expect, type Page, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

async function registerAndLogin(page: Page): Promise<void> {
  const suffix = Date.now()
  await page.goto('/register')
  await page.getByLabel('昵称').fill('地址用户')
  await page.getByLabel('邮箱').fill(`addr-${suffix}@example.com`)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page).toHaveURL(/\/\?page=1$/)
}

test('未登录访问地址管理被重定向到登录页', async ({ page }) => {
  await page.goto('/addresses')
  await expect(page).toHaveURL(/\/login/)
})

test('新增地址 → 默认徽章 → 编辑 → 删除 → 空态', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  await registerAndLogin(page)

  // 新增(设为默认)
  await page.goto('/addresses')
  await expect(page.getByText('还没有收货地址')).toBeVisible()
  await page.getByRole('link', { name: '新增地址' }).click()
  await page.getByLabel('收件人').fill('张三')
  await page.getByLabel('手机号').fill('13800138000')
  await page.getByLabel('详细地址').fill('上海市浦东新区世纪大道 100 号')
  await page.getByLabel('设为默认地址').check()
  await page.getByRole('button', { name: '保存' }).click()

  await expect(page).toHaveURL(/\/addresses$/)
  await expect(page.getByText('张三')).toBeVisible()
  await expect(page.getByText('默认')).toBeVisible()

  // 编辑: 改电话
  await page.getByRole('link', { name: '编辑' }).click()
  await expect(page).toHaveURL(/\/addresses\/[0-9a-f-]{36}\/edit/)
  await page.getByLabel('手机号').fill('13900139000')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page).toHaveURL(/\/addresses$/)
  await expect(page.getByText('13900139000')).toBeVisible()

  // 删除 → 空态
  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('还没有收货地址')).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})
