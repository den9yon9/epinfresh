import { expect, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

test('注册 → 自动登录 → 退出', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  const suffix = Date.now()
  const email = `user-${suffix}@example.com`

  await page.goto('/register')
  await page.getByLabel('昵称').fill('测试用户')
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()

  // 注册后自动登录并回到首页, Header 显示昵称
  await expect(page).toHaveURL(/\/\?page=1$/)
  await expect(page.getByText('测试用户')).toBeVisible()
  await expect(page.getByText('退出')).toBeVisible()

  // 刷新后会话保持
  await page.reload()
  await expect(page.getByText('测试用户')).toBeVisible()

  // 退出
  await page.getByRole('button', { name: '退出' }).click()
  await expect(page.getByText('测试用户')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '登录' })).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})

test('登录页: 错误密码提示', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('邮箱').fill('ghost@example.com')
  await page.getByLabel('密码').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('邮箱或密码错误')).toBeVisible()
})

test('忘记密码 → 发送重置邮件提示', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('link', { name: '忘记密码？' }).click()
  await expect(page).toHaveURL(/\/forgot-password$/)

  await page.getByLabel('邮箱').fill('ghost@example.com')
  await page.getByRole('button', { name: '发送重置邮件' }).click()
  await expect(page.getByText('重置邮件已发送')).toBeVisible()
  await page.getByRole('link', { name: '返回登录' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('登录后回跳受保护页', async ({ page }) => {
  await page.goto('/cart')
  await expect(page).toHaveURL(/\/login\?redirectTo=%2Fcart/)
  await page.getByRole('link', { name: '去注册' }).click()
  await expect(page).toHaveURL(/\/register/)
  await page.getByLabel('昵称').fill('回跳用户')
  const email = `hop-${Date.now()}@example.com`
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel(/密码/).fill('password123')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page).toHaveURL(/\/cart$/)
})
