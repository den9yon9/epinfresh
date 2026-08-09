import { type ConsoleMessage, expect, type Page, test } from '@playwright/test'

// 依赖 dev 库种子数据: db:seed 的 admin 账号 + 至少一笔订单
const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'admin123456'

function collectConsoleErrors(page: Page): { errors: ConsoleMessage[]; pageErrors: Error[] } {
  const errors: ConsoleMessage[] = []
  const pageErrors: Error[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg)
  })
  page.on('pageerror', (err) => pageErrors.push(err))
  return { errors, pageErrors }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('邮箱').fill(ADMIN_EMAIL)
  await page.getByLabel('密码').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('登录 → 仪表盘 → 订单列表 → 详情页导航', async ({ page }) => {
  const { errors, pageErrors } = collectConsoleErrors(page)

  await login(page)
  await expect(page.getByText('快捷入口')).toBeVisible()

  await page.getByRole('navigation').getByText('订单').click()
  await expect(page).toHaveURL(/\/orders(\?page=1)?$/)
  await expect(page.getByRole('button', { name: '全部' })).toBeVisible()

  const viewLink = page.getByRole('link', { name: '查看' }).first()
  await expect(viewLink).toBeVisible()
  await viewLink.click()

  // 回归点: 详情页必须真实渲染 (此前 URL 跳转但 UI 停留在列表页)
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/)
  await expect(page.getByText('订单详情', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /支付记录/ })).toBeVisible()

  expect(pageErrors).toEqual([])
  expect(errors).toEqual([])
})

test('未登录访问受保护页面被重定向到登录页', async ({ page }) => {
  await page.goto('/orders')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})

test('商品新建: 表单提交后出现在列表', async ({ page }) => {
  await login(page)

  await page.getByRole('navigation').getByText('商品').click()
  await expect(page).toHaveURL(/\/products(\?page=1)?$/)
  await page.getByRole('link', { name: '新建商品' }).click()
  await expect(page).toHaveURL(/\/products\/new/)

  const suffix = Date.now()
  await page.getByLabel('名称').first().fill('E2E 商品')
  await page.getByLabel('Slug').fill(`e2e-prod-${suffix}`)
  await page.getByLabel('名称').nth(1).fill('1kg')
  await page.getByLabel('SKU 编码').fill(`E2E-${suffix}`)
  await page.getByLabel('价格（元）').fill('19.9')
  await page.getByRole('button', { name: '创建商品' }).click()

  await expect(page).toHaveURL(/\/products(\?page=1)?$/)
  await expect(page.getByText('E2E 商品').first()).toBeVisible()
})

// 列表按 createdAt 升序, 新商品在末页; 直接按页码访问直到找到目标行
async function findProductRow(page: Page, name: string) {
  for (let i = 1; i <= 20; i++) {
    await page.goto(`/products?page=${i}`)
    // 等列表加载完成(筛选 chips 出现), 避免 loader 竞态
    await expect(page.getByRole('button', { name: '全部' })).toBeVisible()
    const row = page.getByRole('row', { name: new RegExp(name) })
    if (
      await row
        .first()
        .isVisible()
        .catch(() => false)
    )
      return row.first()
    const next = page.getByRole('button', { name: '下一页' })
    if (!(await next.isEnabled())) break
  }
  throw new Error(`product row not found: ${name}`)
}

test('商品编辑改价 → 列表最低价变化 → 删除商品', async ({ page }) => {
  await login(page)

  await page.getByRole('navigation').getByText('商品').click()
  await page.getByRole('link', { name: '新建商品' }).click()
  const suffix = Date.now()
  const name = `编辑测试-${suffix}`
  await page.getByLabel('名称').first().fill(name)
  await page.getByLabel('Slug').fill(`edit-prod-${suffix}`)
  await page.getByLabel('名称').nth(1).fill('1kg')
  await page.getByLabel('SKU 编码').fill(`EDIT-${suffix}`)
  await page.getByLabel('价格（元）').fill('19.9')
  await page.getByRole('button', { name: '创建商品' }).click()

  const row = await findProductRow(page, name)
  await expect(row.getByText('¥19.90')).toBeVisible()

  // 进入编辑页改价
  await row.getByRole('link', { name: '编辑' }).click()
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}$/)
  await page.getByLabel('价格（元）').fill('29.9')
  await page.getByRole('button', { name: '保存' }).click()

  await expect(page).toHaveURL(/\/products(\?page=1)?$/)
  const editedRow = await findProductRow(page, name)
  await expect(editedRow.getByText('¥29.90')).toBeVisible()

  // 删除该商品
  page.on('dialog', (d) => d.accept())
  await editedRow.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(name)).toHaveCount(0)
})

test('分类: 新建 → 列表可见 → 删除', async ({ page }) => {
  await login(page)

  await page.getByRole('navigation').getByText('分类').click()
  await expect(page).toHaveURL(/\/categories/)
  await page.getByRole('button', { name: '新建分类' }).click()

  const suffix = Date.now()
  const name = `e2e分类-${suffix}`
  await page.getByLabel('名称').fill(name)
  await page.getByLabel('Slug').fill(`e2e-cat-${suffix}`)
  await page.getByRole('button', { name: '创建', exact: true }).click()

  await expect(page.getByText(name)).toBeVisible()

  page.on('dialog', (d) => d.accept())
  await page
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('button', { name: '删除' })
    .click()
  await expect(page.getByText(name)).toHaveCount(0)
})

test('用户列表渲染管理员账号', async ({ page }) => {
  await login(page)

  await page.getByRole('navigation').getByText('用户').click()
  await expect(page).toHaveURL(/\/users(\?page=1)?$/)
  await expect(page.getByRole('cell', { name: 'admin@example.com' })).toBeVisible()
  await expect(page.getByText('管理员')).toBeVisible()
})
