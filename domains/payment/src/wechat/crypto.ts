import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
} from 'node:crypto'

// --- 微信支付 APIv3 密码学原语(网关与 pay-mock-server 共用) ---

// RSA-SHA256 签名, base64 输出
export function signMessage(privateKeyPem: string, message: string): string {
  const key = createPrivateKey(privateKeyPem)
  return sign('RSA-SHA256', Buffer.from(message, 'utf8'), key).toString('base64')
}

// RSA-SHA256 验签, 失败(含公钥不匹配/格式错误)统一返回 false
export function verifyMessage(
  publicKeyPem: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem)
    return verify(
      'RSA-SHA256',
      Buffer.from(message, 'utf8'),
      key,
      Buffer.from(signatureBase64, 'base64'),
    )
  } catch {
    return false
  }
}

export interface SignRequestInput {
  merchantId: string
  merchantSerialNo: string
  merchantPrivateKey: string
  method: string
  canonicalUrl: string
  body: string
  timestamp?: string
  nonce?: string
}

// 构造 APIv3 请求 Authorization 头: WECHATPAY2-SHA256-RSA2048
// 验签串: "{method}\n{canonicalUrl}\n{timestamp}\n{nonce}\n{body}\n"
export function buildAuthorizationHeader(input: SignRequestInput): string {
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000))
  const nonce = input.nonce ?? randomBytes(16).toString('hex')
  const message = `${input.method}\n${input.canonicalUrl}\n${timestamp}\n${nonce}\n${input.body}\n`
  const signature = signMessage(input.merchantPrivateKey, message)
  return [
    'WECHATPAY2-SHA256-RSA2048',
    `mchid="${input.merchantId}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${input.merchantSerialNo}"`,
    `signature="${signature}"`,
  ].join(',')
}

export interface VerifyPlatformSignatureInput {
  platformPublicKey: string
  timestamp: string
  nonce: string
  body: string
  signature: string
  // 允许的时间窗口(秒); 微信建议 5 分钟, 防重放
  toleranceSeconds?: number
}

// 校验微信平台回调签名: 验签 + 时间戳防重放
export function verifyPlatformSignature(input: VerifyPlatformSignatureInput): boolean {
  const tolerance = input.toleranceSeconds ?? 5 * 60
  const now = Math.floor(Date.now() / 1000)
  const ts = Number(input.timestamp)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > tolerance) return false
  const message = `${input.timestamp}\n${input.nonce}\n${input.body}\n`
  return verifyMessage(input.platformPublicKey, message, input.signature)
}

export interface AesGcmCiphertext {
  ciphertext: string
  nonce: string
  associated_data: string
}

function requireApiV3Key(apiV3Key: string): Buffer {
  const key = Buffer.from(apiV3Key, 'utf8')
  if (key.length !== 32) {
    throw new Error('[wechat] APIv3 key must be exactly 32 bytes (utf8)')
  }
  return key
}

// AES-256-GCM 加密; 密文末尾追加 16 字节 auth tag(与微信格式一致)
export function aesGcmEncrypt(
  apiV3Key: string,
  plaintext: string,
  associatedData = '',
): AesGcmCiphertext {
  const key = requireApiV3Key(apiV3Key)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([encrypted, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
    associated_data: associatedData,
  }
}

// AES-256-GCM 解密; 密文尾部 16 字节为 auth tag
export function aesGcmDecrypt(apiV3Key: string, encrypted: AesGcmCiphertext): string {
  const key = requireApiV3Key(apiV3Key)
  const data = Buffer.from(encrypted.ciphertext, 'base64')
  if (data.length <= 16) throw new Error('[wechat] invalid AES-GCM ciphertext')
  const tag = data.subarray(data.length - 16)
  const body = data.subarray(0, data.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.nonce, 'base64'))
  decipher.setAAD(Buffer.from(encrypted.associated_data ?? '', 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

// 生成测试用 RSA 密钥对(dev/pay-mock-server/测试共用以避免外部依赖)
export function generateRsaKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { privateKey, publicKey }
}
