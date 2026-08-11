import { useSyncExternalStore } from 'react'

import { api } from './client'
import type { AuthUser } from './types'

// 轻量会话 store: Header/受保护页面共享登录态, 避免逐层传参
//
// 登录态持久化到 localStorage: 刷新页面时同步恢复, 避免每次加载先渲染 "…" 占位再校验。
// 仅作展示快照, 服务端会话仍以 cookie 为准; 受保护页 beforeLoad 会强制 refreshSession 校验。
const SESSION_CACHE_KEY = 'epinfresh.session.user'

let current: AuthUser | null | undefined = readCachedSession()
const listeners = new Set<() => void>()

function readCachedSession(): AuthUser | null | undefined {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AuthUser
  } catch {
    // 隐私模式/存储不可用时回退为未知态, 由 refreshSession 兜底
    return undefined
  }
}

function persist(value: AuthUser | null) {
  try {
    if (value === null) localStorage.removeItem(SESSION_CACHE_KEY)
    else localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(value))
  } catch {
    // 存储不可用时静默降级, 不影响会话本身
  }
}

function notify() {
  listeners.forEach((fn) => fn())
}

export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSession(): AuthUser | null | undefined {
  return current
}

export function useSession(): AuthUser | null | undefined {
  return useSyncExternalStore(subscribeSession, getSession)
}

export async function refreshSession(): Promise<AuthUser | null> {
  const res = await api.auth.me.get()
  current = res.error === null ? res.data : null
  persist(current)
  notify()
  return current
}

export async function login(
  email: string,
  password: string,
): Promise<{ user: AuthUser | null; error: string | null }> {
  const res = await api.auth.login.post({ email, password })
  if (res.error) {
    const code = 'error' in res.error.value ? res.error.value.error : undefined
    return { user: null, error: code ?? 'LOGIN_FAILED' }
  }
  current = res.data
  persist(current)
  notify()
  return { user: res.data, error: null }
}

export async function logout(): Promise<void> {
  await api.auth.logout.post()
  current = null
  persist(current)
  notify()
}

// 统一 401 处理: 清本地会话缓存 + 通知订阅者, 返回是否确为 401
// 调用方(loader/交互回调)负责随后跳转登录页
export function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: number }).status === 401
  )
}

export function clearSessionCache(): void {
  current = null
  persist(current)
  notify()
}
