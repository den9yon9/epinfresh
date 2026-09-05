// k6 压测脚本: 生鲜 C 端结算下单链路(登录 → 加购 → 结算幂等下单)。
// 运行前提: storefront-api + postgres + redis 已启动(pnpm dev 或 compose),
// 且已有验收账号 buyer@example.com / buyer123456(由测试环境数据保证, 脚本内自动注册不适用,
// 密码重置无需; 若账号不存在, 脚本将因登录失败而报错 → 先手动注册一次)。
// 运行: k6 run scripts/k6/checkout.js      (默认 1 分钟 25 并发)
//        k6 run --vus 50 --duration 2m scripts/k6/checkout.js
import { check, fail, sleep } from 'k6'
import http from 'k6/http'

const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:3000'
const EMAIL = __ENV.BUYER_EMAIL ?? 'buyer@example.com'
const PASSWORD = __ENV.BUYER_PASSWORD ?? 'buyer123456'

export const options = {
  scenarios: {
    checkout: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS ?? 25),
      duration: __ENV.DURATION ?? '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // 错误率 < 1%
    http_req_duration: ['p(95)<800'], // P95 延迟 < 800ms
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
}

function login() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  )
  check(res, { 'login status 200': (r) => r.status === 200 })
  return res
}

function getCart() {
  const res = http.get(`${BASE_URL}/cart`)
  return res
}

export function setup() {
  // setup 每数据集跑一次: 登录拿 cookie(会话存 JAR), 并取购物车现有内容作为结算项
  const loginRes = login()
  if (loginRes.status !== 200) {
    fail(`login failed (maybe seed buyer ${EMAIL} missing?): ${loginRes.status}`)
  }
  const cartRes = getCart()
  const items = (cartRes.json().items ?? []).map((i) => ({ skuId: i.sku.id, quantity: 1 }))
  if (items.length === 0) {
    fail('cart is empty: seed the buyer cart first (add a product in storefront-web)')
  }
  return { items }
}

export default function (data) {
  // 幂等键: 每次迭代一个新 key → 每 VU 每次提交都是新订单(高并发下订单态膨胀;
  // 压测场景本就以写入为主, 关注吞吐/延迟/错误率)
  const idemKey = `k6-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const addrRes = http.get(`${BASE_URL}/addresses`)
  const addresses = addrRes.json().items ?? []
  if (addresses.length === 0) return // 无地址跳过本轮(校验失败交给阈值)
  const body = JSON.stringify({ addressId: addresses[0].id, items: data.items })

  const res = http.post(`${BASE_URL}/orders`, body, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idemKey,
    },
  })
  check(res, {
    'order accepted (200/201)': (r) => r.status === 200 || r.status === 201,
  })
  // 幂等与库存约束: BODY_MISMATCH(422)/库存不足(409)在压测下出现即视为异常命中
  check(res, { 'no idempotency drift (422)': (r) => r.status !== 422 })
  sleep(0.2)
}
