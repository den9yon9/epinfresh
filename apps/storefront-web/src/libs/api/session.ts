import { useSyncExternalStore } from 'react'

import { api } from './client'
import type { AuthUser } from './types'

// 轻量会话 store: Header/受保护页面共享登录态, 避免逐层传参
let current: AuthUser | null | undefined = undefined
const listeners = new Set<() => void>()

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
  notify()
  return current
}

export async function login(email: string, password: string): Promise<AuthUser | null> {
  const res = await api.auth.login.post({ email, password })
  if (res.error) return null
  current = res.data
  notify()
  return current
}

export async function logout(): Promise<void> {
  await api.auth.logout.post()
  current = null
  notify()
}
