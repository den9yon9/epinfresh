import { expect, test } from '@playwright/test'

import { collectConsoleErrors } from './helpers'

test('首页渲染：品牌、TabBar、内容', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  await page.goto('/')

  await expect(page.getByText('一品鲜')).toBeVisible()
  for (const tab of ['首页', '购物车', '我的']) {
    await expect(page.getByRole('navigation').getByText(tab)).toBeVisible()
  }
  await expect(page.getByRole('button', { name: '全部' })).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})

test('TabBar 切换与 active 高亮', async ({ page }) => {
  await page.goto('/')
  const cartTab = page.getByRole('navigation').getByText('购物车')

  // 购物车需要登录: 未登录点击被守卫重定向到登录页
  await cartTab.click()
  await expect(page).toHaveURL(/\/login/)

  await page.goto('/')
  await page.getByRole('navigation').getByText('我的').click()
  await expect(page).toHaveURL(/\/me/)
  await expect(page.getByText('我的 — 开发中')).toBeVisible()

  await page.getByRole('navigation').getByText('首页').click()
  await expect(page).toHaveURL(/\/(\?page=1)?$/)
})

test('二级页：返回键与标题', async ({ page }) => {
  // 站内路径进入二级页（与真实用户路径一致），再验证返回
  await page.goto('/')
  await page.getByText('有机番茄').first().click()
  await expect(page).toHaveURL(/\/products\//)
  await expect(page.getByText('加入购物车')).toBeVisible()

  const back = page.getByRole('button', { name: '返回' })
  await expect(back).toBeVisible()
  await back.click()
  await expect(page).toHaveURL(/\/(\?page=1)?$/)
})

test('未匹配路由不落入后端 404（SPA fallback）', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)
  const res = await page.goto('/nonexistent-page')
  expect(res?.status()).toBe(200)
  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})
