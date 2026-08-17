import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 生成微信支付联调密钥对(本地 mock 用):
//   keys/merchant_key.pem   商户私钥 — storefront-api 出站签名 / pay-mock-server 派生公钥验签
//   keys/platform_key.pem   假平台私钥 — pay-mock-server 签回调
//   keys/platform_pub.pem   假平台公钥 — storefront-api 验回调
// 并输出一份可直接追加到 .env 的配置片段。真实商户号到位后, 商户侧替换为微信官方证书。
const dir = join(import.meta.dir, '..', 'keys')
mkdirSync(dir, { recursive: true })

function writeKey(name: string, privateKey: string, publicKey: string) {
  writeFileSync(join(dir, name), privateKey, 'utf8')
  console.log(`wrote ${dir}/${name}`)
  return publicKey
}

const merchant = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
writeKey('merchant_key.pem', merchant.privateKey, merchant.publicKey)

const platform = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
writeKey('platform_key.pem', platform.privateKey, platform.publicKey)
writeFileSync(join(dir, 'platform_pub.pem'), platform.publicKey, 'utf8')
console.log(`wrote ${dir}/platform_pub.pem`)

const apiV3Key = randomBytes(32).toString('base64')
const serialNo = `MOCK-${randomBytes(4).toString('hex').toUpperCase()}`

console.log(`
# --- 追加到 .env ---
# storefront-api(联调模式: 网关出站指向本地模拟器)
PAYMENT_GATEWAY=wechat
WECHAT_API_BASE=http://localhost:8787
WECHAT_MERCHANT_ID=mock-merchant-1
WECHAT_APP_ID=mock-app-1
WECHAT_API_V3_KEY=${apiV3Key}
WECHAT_MERCHANT_SERIAL_NO=${serialNo}
WECHAT_MERCHANT_PRIVATE_KEY_PATH=${dir}/merchant_key.pem
WECHAT_PLATFORM_PUBLIC_KEY_PATH=${dir}/platform_pub.pem
WECHAT_NOTIFY_URL=http://localhost:3000/payments/notify/wechat

# pay-mock-server
PAY_MOCK_PORT=8787
PAY_MOCK_MERCHANT_ID=mock-merchant-1
PAY_MOCK_APP_ID=mock-app-1
PAY_MOCK_API_V3_KEY=${apiV3Key}
PAY_MOCK_MERCHANT_PRIVATE_KEY_PATH=${dir}/merchant_key.pem
PAY_MOCK_PLATFORM_PRIVATE_KEY_PATH=${dir}/platform_key.pem
PAY_MOCK_PLATFORM_SERIAL_NO=${serialNo}
PAY_MOCK_NOTIFY_URL=http://localhost:3000/payments/notify/wechat
`)
