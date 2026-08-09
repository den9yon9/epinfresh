import { expect, type Page, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

async function registerAndLogin(page: Page): Promise<string> {
  const suffix = Date.now()
  const email = `me-${suffix}@example.com`
  await page.goto('/register')
  await page.getByLabel('昵称').fill('我的用户')
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page).toHaveURL(/\/\?page=1$/)
  return email
}

test('未登录访问我的页被重定向到登录页', async ({ page }) => {
  await page.goto('/me')
  await expect(page).toHaveURL(/\/login/)
})

test('我的页: 用户信息与功能入口', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  const email = await registerAndLogin(page)

  await page.getByRole('navigation').getByText('我的').click()
  await expect(page).toHaveURL(/\/me$/)

  // 用户信息(Header 也显示昵称, 取第一个)
  await expect(page.getByText('我的用户').first()).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()
  await expect(page.getByText('普通用户')).toBeVisible()

  // 功能入口跳转(订单页无 TabBar, 用 goto 回我的页)
  await page.getByRole('link', { name: /我的订单/ }).click()
  await expect(page).toHaveURL(/\/orders(\?page=1)?$/)
  await page.goto('/me')
  await page.getByRole('link', { name: /收货地址/ }).click()
  await expect(page).toHaveURL(/\/addresses$/)

  // 退出登录 → 首页显示登录
  await page.goto('/me')
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/\?page=1$/)
  await expect(page.getByRole('link', { name: '登录' })).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})
