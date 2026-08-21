import { createHash, randomBytes } from 'node:crypto'

import { ErrorResponse } from '@epinfresh/shared'
import { Elysia, status, t } from 'elysia'

import { type StorefrontPlugins } from '../plugins'

// 公众号网页授权 + JS-SDK: 微信内置浏览器 JSAPI 支付的前置。
// - /auth/wechat/authorize: 跳微信授权页 → 回跳 callback
// - /auth/wechat/callback: code 换 openid, 写入签名 cookie wechat_openid
// - /wechat/jssdk: 对当前页面 URL 生成 JS-SDK wx.config 签名(jsapi_ticket)
// 联调期 WECHAT_OAUTH_* 指向 pay-mock-server; 真实指向 open/api.weixin.qq.com。

const OPENID_COOKIE = 'wechat_openid'
const OPENID_TTL_SECONDS = 30 * 24 * 60 * 60

function oauthDisabled(enabled: boolean) {
  if (enabled) return null
  return status(400, { error: 'WECHAT_OAUTH_DISABLED', message: 'WeChat OAuth not configured' })
}

export function createWechatRoutes(plugins: StorefrontPlugins) {
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
    const res = await fetch(url.toString())
    const data = (await res.json()) as { openid?: string }
    return data.openid ?? null
  }

  async function fetchJsapiTicket(): Promise<string> {
    const tokenUrl = new URL('/cgi-bin/token', wechatOauth.apiBase)
    tokenUrl.searchParams.set('grant_type', 'client_credential')
    tokenUrl.searchParams.set('appid', wechatOauth.appId)
    tokenUrl.searchParams.set('secret', wechatOauth.appSecret)
    const tokenRes = await fetch(tokenUrl.toString())
    const tokenData = (await tokenRes.json()) as { access_token?: string }
    if (!tokenData.access_token) throw new Error('wechat access_token fetch failed')
    const ticketUrl = new URL('/cgi-bin/ticket/getticket', wechatOauth.apiBase)
    ticketUrl.searchParams.set('access_token', tokenData.access_token)
    ticketUrl.searchParams.set('type', 'jsapi')
    const ticketRes = await fetch(ticketUrl.toString())
    const ticketData = (await ticketRes.json()) as { ticket?: string }
    if (!ticketData.ticket) throw new Error('wechat jsapi_ticket fetch failed')
    return ticketData.ticket
  }

  return new Elysia({ name: 'wechat-storefront' })
    .get(
      '/auth/wechat/authorize',
      ({ query, request }) => {
        const disabled = oauthDisabled(wechatOauth.enabled)
        if (disabled) return disabled
        const redirectTo = query.redirectTo ?? '/'
        const url = new URL('/connect/oauth2/authorize', wechatOauth.baseUrl)
        url.searchParams.set('appid', wechatOauth.appId)
        url.searchParams.set('redirect_uri', buildCallbackUrl(request))
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('scope', 'snsapi_base')
        url.searchParams.set('state', redirectTo)
        return new Response(null, { status: 302, headers: { Location: url.toString() } })
      },
      {
        query: t.Object({ redirectTo: t.Optional(t.String()) }),
        response: { 400: ErrorResponse },
        detail: {
          tags: ['WeChat'],
          summary: '微信网页授权入口',
          description:
            '跳转到微信授权页获取 openid(JSAPI 支付前置)。授权完成后回跳 /auth/wechat/callback 并带上 redirectTo。',
        },
      },
    )
    .get(
      '/auth/wechat/callback',
      async ({ query, cookie }) => {
        const disabled = oauthDisabled(wechatOauth.enabled)
        if (disabled) return disabled
        const openid = await fetchOpenid(query.code)
        if (!openid) {
          logger.warn({ code: query.code }, 'wechat oauth code exchange failed')
          return status(400, {
            error: 'WECHAT_OAUTH_FAILED',
            message: 'WeChat authorization failed',
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
        return new Response(null, { status: 302, headers: { Location: query.state ?? '/' } })
      },
      {
        query: t.Object({ code: t.String(), state: t.Optional(t.String()) }),
        response: { 400: ErrorResponse },
        detail: {
          tags: ['WeChat'],
          summary: '微信授权回调',
          description: '用 code 换取 openid 并写入签名 cookie，随后 302 回 redirectTo。',
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
      async ({ query }) => {
        const disabled = oauthDisabled(wechatOauth.enabled)
        if (disabled) return disabled
        try {
          const jsapiTicket = await fetchJsapiTicket()
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
          return status(502, { error: 'JSSDK_SIGN_FAILED', message: 'JS-SDK signature failed' })
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
