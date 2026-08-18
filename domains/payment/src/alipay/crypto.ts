import { createSign, createVerify } from 'node:crypto'

// 支付宝 RSA2(RSA-SHA256) 签名/验签工具。
// 签名内容: 除 sign/sign_type 与空值外的所有参数按 key 升序(字节序)拼接为 k=v&...。
export function buildAlipaySignContent(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && key !== 'sign_type' && value !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

export function rsa2Sign(content: string, privateKey: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(content, 'utf8')
  signer.end()
  return signer.sign(privateKey, 'base64')
}

export function rsa2Verify(content: string, signature: string, publicKey: string): boolean {
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(content, 'utf8')
    verifier.end()
    return verifier.verify(publicKey, signature, 'base64')
  } catch {
    return false
  }
}

// 支付宝业务时间戳: yyyy-MM-dd HH:mm:ss
export function alipayTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
