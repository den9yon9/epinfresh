import { type ConsoleMessage, type Page } from '@playwright/test'

// 未登录时 Header 的 /auth/me 返回 401, 浏览器会记一条资源加载错误——这是预期行为, 过滤掉
function isExpectedAuthError(msg: ConsoleMessage): boolean {
  return msg.type() === 'error' && msg.text().includes('status of 401')
}

export function collectConsoleErrors(page: Page): {
  errors: ConsoleMessage[]
  pageErrors: Error[]
} {
  const errors: ConsoleMessage[] = []
  const pageErrors: Error[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isExpectedAuthError(msg)) errors.push(msg)
  })
  page.on('pageerror', (err) => pageErrors.push(err))
  return { errors, pageErrors }
}
