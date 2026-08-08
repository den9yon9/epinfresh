import { expect, test } from '@playwright/test'

test('首页展示分类与商品列表', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '全部' })).toBeVisible()
  for (const category of ['蔬菜', '水果', '肉禽蛋', '海鲜水产']) {
    await expect(page.getByRole('button', { name: category })).toBeVisible()
  }
  await expect(page.getByText('有机番茄')).toBeVisible()
  await expect(page.getByText('红富士苹果')).toBeVisible()
})

test('分类筛选与分页', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '水果', exact: true }).click()
  await expect(page).toHaveURL(/categoryId=/)
  await expect(page.getByText('红富士苹果')).toBeVisible()
  await expect(page.getByText('有机番茄')).toHaveCount(0)

  await page.getByRole('button', { name: '全部' }).click()
  await expect(page).not.toHaveURL(/categoryId=/)
  await expect(page.getByText('有机番茄')).toBeVisible()
})

test('商品详情：SKU 选择与加购引导', async ({ page }) => {
  await page.goto('/')
  await page.getByText('有机番茄').first().click()
  await expect(page).toHaveURL(/\/products\//)
  await expect(page.getByText('沙瓤多汁')).toBeVisible()

  // 多个 SKU 可选
  await expect(page.getByRole('button', { name: /有机番茄 500g/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /有机番茄 1kg/ })).toBeVisible()

  // 未登录加购 → 跳到登录页
  await page.getByRole('button', { name: '加入购物车' }).click()
  await expect(page).toHaveURL(/\/login/)
})
