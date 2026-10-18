import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { type Translator } from '@epinfresh/i18n'
import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'
import { createTicketCache } from '../wechatTicket'

// 公众号网页授权 + JS-SDK: 微信内置浏览器 JSAPI 支付的前置。
// - /auth/wechat/authorize: 跳微信授权页 → 回跳 callback
// - /auth/wechat/callback: code 换 openid, 写入签名 cookie wechat_openid
// - /wechat/jssdk: 对当前页面 URL 生成 JS-SDK wx.config 签名(jsapi_ticket)
// 联调期 WECHAT_OAUTH_* 指向 pay-mock-server; 真实指向 open/api.weixin.qq.com。

const OPENID_COOKIE = 'wechat_openid'
const OAUTH_STATE_COOKIE = 'wechat_oauth_state'
const OPENID_TTL_SECONDS = 30 * 24 * 60 * 60
const OAUTH_STATE_TTL_SECONDS = 10 * 60
const OUTBOUND_TIMEOUT_MS = 5000
const JSAPI_TICKET_TTL_MS = 7000 * 1000

// state 的安全语义: 随机 nonce 防 CSRF, 跳转目标只允许站内相对路径防开放重定向。
// 拒绝 //host(协议相对)与反斜杠变体; 非法值统一回退首页。
function safeRedirectPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  return raw
}

function timingSafeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

interface OauthState {
  nonce: string
  redirectTo: string
}

function parseOauthState(raw: unknown): OauthState | null {
  if (raw === null || raw === undefined) return null
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const { nonce, redirectTo } = value as Partial<OauthState>
  if (typeof nonce !== 'string' || typeof redirectTo !== 'string') return null
  return { nonce, redirectTo }
}

function oauthDisabled(enabled: boolean, i18n: Translator) {
  if (enabled) return null
  return status(400, {
    error: 'WECHAT_OAUTH_DISABLED',
    message: i18n('WeChat OAuth not configured'),
  })
}

// JS-SDK 签名只允许本站 origin(防签名滥用); dev 下 corsOrigin=true 放行
function isAllowedOrigin(origin: string, corsOrigin: true | string | string[]): boolean {
  if (corsOrigin === true) return true
  const allowed = Array.isArray(corsOrigin) ? corsOrigin : [corsOrigin]
  return allowed.includes(origin)
}

export function createWechatRoutes(
  plugins: StorefrontPlugins,
  corsOrigin: true | string | string[],
) {
  const { wechatOauth, isProduction, logger } = plugins

  // 回跳地址基于请求头(生产 nginx 注入 X-Forwarded-*)
  function buildCallbackUrl(request: Request): string {
    const headers = request.headers
    const proto = headers.get('x-forwarded-proto') ?? 'http'
    const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000'
    return `${proto}://${host}/auth/wechat/callback`
  }

  async function fetchOpenid(code: string): Promise<string | null> {
    const url = new URL('/sns/oauth2/access_token', wechatOauth.apiBase)
    url.searchParams.set('appid', wechatOauth.appId)
    url.searchParams.set('secret', wechatOauth.appSecret)
    url.searchParams.set('code', code)
    url.searchParams.set('grant_type', 'authorization_code')
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS) })
    const data = (await res.json()) as { openid?: string }
    return data.openid ?? null
  }

  async function fetchJsapiTicket(): Promise<string> {
    const tokenUrl = new URL('/cgi-bin/token', wechatOauth.apiBase)
    tokenUrl.searchParams.set('grant_type', 'client_credential')
    tokenUrl.searchParams.set('appid', wechatOauth.appId)
    tokenUrl.searchParams.set('secret', wechatOauth.appSecret)
    const tokenRes = await fetch(tokenUrl.toString(), {
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    })
    const tokenData = (await tokenRes.json()) as { access_token?: string }
    if (!tokenData.access_token) throw new Error('wechat access_token fetch failed')
    const ticketUrl = new URL('/cgi-bin/ticket/getticket', wechatOauth.apiBase)
    ticketUrl.searchParams.set('access_token', tokenData.access_token)
    ticketUrl.searchParams.set('type', 'jsapi')
    const ticketRes = await fetch(ticketUrl.toString(), {
      signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
    })
    const ticketData = (await ticketRes.json()) as { ticket?: string }
    if (!ticketData.ticket) throw new Error('wechat jsapi_ticket fetch failed')
    return ticketData.ticket
  }

  // access_token + jsapi_ticket 均为 7200s TTL 的全局配额资源, 缓存复用避免逐请求刷新触发限频
  const jsapiTicketCache = createTicketCache({
    ttlMs: JSAPI_TICKET_TTL_MS,
    load: fetchJsapiTicket,
  })

  return new Elysia({ name: 'wechat-storefront' })
    .use(plugins.localePlugin)
    .get(
      '/auth/wechat/authorize',
      ({ query, request, cookie, i18n }) => {
        const disabled = oauthDisabled(wechatOauth.enabled, i18n)
        if (disabled) return disabled
        const redirectTo = safeRedirectPath(query.redirectTo)
        const nonce = randomBytes(16).toString('hex')
        // nonce 交给微信原样回传用于校验; 跳转目标存签名 cookie(不可被 query 篡改)
        cookie[OAUTH_STATE_COOKIE].set({
          value: JSON.stringify({ nonce, redirectTo }),
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax',
          path: '/',
          maxAge: OAUTH_STATE_TTL_SECONDS,
        })
        const url = new URL('/connect/oauth2/authorize', wechatOauth.baseUrl)
        url.searchParams.set('appid', wechatOauth.appId)
        url.searchParams.set('redirect_uri', buildCallbackUrl(request))
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('scope', 'snsapi_base')
        url.searchParams.set('state', nonce)
        return new Response(null, { status: 302, headers: { Location: url.toString() } })
      },
      {
        query: t.Object({ redirectTo: t.Optional(t.String()) }),
        response: { 400: ErrorResponse },
        detail: {
          tags: ['WeChat'],
          summary: '微信网页授权入口',
          description:
            '跳转到微信授权页获取 openid(JSAPI 支付前置)。授权完成后回跳 /auth/wechat/callback 并带上随机 state。',
        },
      },
    )
    .get(
      '/auth/wechat/callback',
      async ({ query, cookie, i18n }) => {
        const disabled = oauthDisabled(wechatOauth.enabled, i18n)
        if (disabled) return disabled
        // state 必须与发起授权时写入的签名 cookie 匹配(防 CSRF); 校验后立即失效
        const expected = parseOauthState(cookie[OAUTH_STATE_COOKIE].value)
        cookie[OAUTH_STATE_COOKIE].remove()
        if (!expected || !query.state || !timingSafeEqualString(expected.nonce, query.state)) {
          logger.warn({ state: query.state }, 'wechat oauth state mismatch')
          return status(400, {
            error: 'WECHAT_OAUTH_STATE_MISMATCH',
            message: i18n('Invalid OAuth state'),
          })
        }
        const openid = await fetchOpenid(query.code)
        if (!openid) {
          logger.warn({ code: query.code }, 'wechat oauth code exchange failed')
          return status(400, {
            error: 'WECHAT_OAUTH_FAILED',
            message: i18n('WeChat authorization failed'),
          })
        }
        cookie[OPENID_COOKIE].set({
          value: openid,
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax',
          path: '/',
          maxAge: OPENID_TTL_SECONDS,
        })
        return new Response(null, {
          status: 302,
          headers: { Location: safeRedirectPath(expected.redirectTo) },
        })
      },
      {
        query: t.Object({ code: t.String(), state: t.Optional(t.String()) }),
        response: { 400: ErrorResponse },
        detail: {
          tags: ['WeChat'],
          summary: '微信授权回调',
          description:
            '校验 state 后，用 code 换取 openid 并写入签名 cookie，随后 302 回授权时登记的站内路径。',
        },
      },
    )
    .get(
      '/auth/wechat/openid',
      ({ cookie }) => {
        // 返回已授权的 openid(签名 cookie); 未授权返回 null, 前端据此触发授权跳转
        const openid = cookie[OPENID_COOKIE].value
        return { openid: typeof openid === 'string' && openid.length > 0 ? openid : null }
      },
      {
        response: { 200: t.Object({ openid: t.Union([t.String(), t.Null()]) }) },
        detail: {
          tags: ['WeChat'],
          summary: '查询微信 openid',
          description: '返回当前浏览器的微信 openid(来自授权 cookie); 未授权为 null。',
        },
      },
    )
    .get(
      '/wechat/jssdk',
      async ({ query, i18n }) => {
        const disabled = oauthDisabled(wechatOauth.enabled, i18n)
        if (disabled) return disabled
        // url 必须属于本站 origin, 否则拒绝签名
        let origin: string
        try {
          origin = new URL(query.url).origin
        } catch {
          return status(400, { error: 'JSSDK_URL_DENIED', message: i18n('Invalid url') })
        }
        if (!isAllowedOrigin(origin, corsOrigin)) {
          return status(400, { error: 'JSSDK_URL_DENIED', message: i18n('Origin not allowed') })
        }
        try {
          const jsapiTicket = await jsapiTicketCache.get()
          const timestamp = String(Math.floor(Date.now() / 1000))
          const nonceStr = randomBytes(8).toString('hex')
          // JS-SDK 配置签名: SHA1(jsapi_ticket\n timestamp\n nonceStr\n url\n)
          const raw = `${jsapiTicket}\n${timestamp}\n${nonceStr}\n${query.url}\n`
          const signature = createHash('sha1').update(raw, 'utf8').digest('hex')
          return { appId: wechatOauth.appId, timestamp, nonceStr, signature }
        } catch (caught) {
          logger.warn(
            { err: caught instanceof Error ? caught.message : String(caught) },
            'jssdk signature failed',
          )
          return status(502, {
            error: 'JSSDK_SIGN_FAILED',
            message: i18n('JS-SDK signature failed'),
          })
        }
      },
      {
        query: t.Object({ url: t.String() }),
        response: {
          200: t.Object({
            appId: t.String(),
            timestamp: t.String(),
            nonceStr: t.String(),
            signature: t.String(),
          }),
          400: ErrorResponse,
          502: ErrorResponse,
        },
        detail: {
          tags: ['WeChat'],
          summary: 'JS-SDK 配置签名',
          description: '对当前页面 URL 生成 wx.config 所需签名(jsapi_ticket + SHA1)。',
        },
      },
    )
}
