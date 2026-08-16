// redirectTo 可能是纯 path(如 /orders/123) 或带 query(如 /pay?orderId=x)。
// navigate 的 `to` 不解析 query string, 这里拆成 { to, search } 再交给 navigate。
export function parseRedirect(redirectTo: string): { to: string; search: Record<string, string> } {
  const url = new URL(redirectTo, window.location.origin)
  return {
    to: url.pathname,
    search: url.searchParams.size > 0 ? Object.fromEntries(url.searchParams.entries()) : {},
  }
}
