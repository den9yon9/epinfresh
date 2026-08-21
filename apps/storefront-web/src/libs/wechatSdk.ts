// 微信 JS-SDK 最小类型 + 动态加载。
// 真实环境需在微信内置浏览器加载 jweixin 脚本后才可用 window.wx(用于 wx.config / wx.chooseWXPay)。

export type WeChatSDK = {
  config: (cfg: {
    debug?: boolean
    appId: string
    timestamp: string
    nonceStr: string
    signature: string
    jsApiList: string[]
  }) => void
  ready: (cb: () => void) => void
  error: (cb: (err: unknown) => void) => void
  chooseWXPay: (opts: {
    timestamp: string
    nonceStr: string
    package: string
    signType: string
    paySign: string
    success: () => void
    fail: (err: unknown) => void
    cancel: () => void
  }) => void
}

declare global {
  interface Window {
    wx?: WeChatSDK
  }
}

const JSSDK_SRC = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js'

let loadPromise: Promise<WeChatSDK> | null = null

// 动态注入 jweixin 脚本并返回 window.wx; 缓存 Promise, 重复调用不重复加载
export function loadWechatJssdk(): Promise<WeChatSDK> {
  if (!loadPromise) {
    loadPromise = new Promise<WeChatSDK>((resolve, reject) => {
      if (window.wx) {
        resolve(window.wx)
        return
      }
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${JSSDK_SRC}"]`)
      if (existing && window.wx) {
        resolve(window.wx)
        return
      }
      const script = existing ?? document.createElement('script')
      script.onload = () => {
        if (window.wx) resolve(window.wx)
        else reject(new Error('wechat jssdk not exposed on window'))
      }
      script.onerror = () => reject(new Error('wechat jssdk script failed to load'))
      if (!existing) {
        script.src = JSSDK_SRC
        script.async = true
        document.head.appendChild(script)
      }
    })
    // 加载失败允许下次重试
    loadPromise.catch(() => {
      loadPromise = null
    })
  }
  return loadPromise
}
