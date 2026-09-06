// k6 压测脚本: 生鲜 C 端结算下单链路(登录 → 加购 → 结算幂等下单)。
// 运行前提: storefront-api + postgres + redis 已启动(pnpm dev 或 compose),
// 且已有验收账号 buyer@example.com / buyer123456(由测试环境数据保证, 脚本内自动注册不适用;
// 密码重置无需; 若账号不存在, 脚本将因登录失败而报错 → 先手动注册一次)。
// 运行: k6 run scripts/k6/checkout.js      (默认 1 分钟 25 并发)
//        k6 run --vus 50 --duration 2m scripts/k6/checkout.js
//
// 设计要点(避免打爆登录限流):
//   - 只在 setup() 登录一次, 复用同一 session(同一 buyer 下单不重读购物车, 共享登录态无副作用)。
//   - default() 不再逐迭代登录, 且不再每迭代 GET /addresses。
//   - 若 buyer 没有收货地址, setup() 自动 POST /addresses 建一条, 保证结算下单链路被真正压到。
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

function authHeaders(sessionCookie) {
  return { 'Content-Type': 'application/json', Cookie: `session_id=${sessionCookie}` }
}

export function setup() {
  // 只登录一次: 几十个 VU 共享同一 session, 登录限流(AUTH_RATE_LIMIT_PER_MINUTE 默认 20/min/IP)
  // 不会被压测打爆。真实用户模型本就是一次登录复用会话。
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  if (loginRes.status !== 200) {
    fail(`login failed (maybe seed buyer ${EMAIL} missing?): ${loginRes.status}`)
  }
  const sessionCookie = loginRes.cookies.session_id?.[0]?.value
  if (!sessionCookie) {
    fail('login succeeded but no session_id cookie returned')
  }

  const cartRes = http.get(`${BASE_URL}/cart`, { headers: authHeaders(sessionCookie) })
  let items = (cartRes.json().items ?? []).map((i) => ({ skuId: i.sku.id, quantity: 1 }))
  if (items.length === 0) {
    // 购物车空: 自动补 1 件有库存的商品, 避免每次压测后购物车被清空又要手动播种。
    // 下单结算会删除结算涉及的 SKU(见 usecases/checkout checkout → removeCartItems), 因此脚本需自包含。
    const prodRes = http.get(`${BASE_URL}/products?limit=50`)
    const sku = (prodRes.json().items ?? [])
      .flatMap((p) => p.skus ?? [])
      .filter((s) => Number(s.stock) > 0)
      .sort((a, b) => Number(b.stock) - Number(a.stock))[0]
    if (!sku) {
      fail('cart empty and no in-stock sku found to seed (add a product in storefront-web)')
    }
    const addRes = http.post(
      `${BASE_URL}/cart/items`,
      JSON.stringify({ skuId: sku.id, quantity: 1 }),
      { headers: authHeaders(sessionCookie) },
    )
    if (addRes.status !== 201) {
      fail(`auto-seed cart failed: ${addRes.status}`)
    }
    items = [{ skuId: sku.id, quantity: 1 }]
  }

  // 结算必须要有收货地址; 为空则自动建一条, 避免 default() 因无地址空转只压到登录。
  const addrRes = http.get(`${BASE_URL}/addresses`, { headers: authHeaders(sessionCookie) })
  let addressId = addrRes.json().items?.[0]?.id
  if (!addressId) {
    const created = http.post(
      `${BASE_URL}/addresses`,
      JSON.stringify({
        recipientName: 'k6 压测买家',
        phone: '13800000000',
        province: '广东省',
        city: '深圳市',
        district: '南山区',
        detail: '科技园 k6 load-test 1 号',
      }),
      { headers: authHeaders(sessionCookie) },
    )
    if (created.status !== 201) {
      fail(`create address failed: ${created.status}`)
    }
    addressId = created.json().id
  }

  return { items, addressId, sessionCookie }
}

export default function (data) {
  // 幂等键: 每次迭代一个新 key → 每次提交都是新订单(高并发下订单态膨胀;
  // 压测场景本就以写入为主, 关注吞吐/延迟/错误率)。
  const idemKey = `k6-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const body = JSON.stringify({ addressId: data.addressId, items: data.items })

  const res = http.post(`${BASE_URL}/orders`, body, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idemKey,
      Cookie: `session_id=${data.sessionCookie}`,
    },
  })
  check(res, {
    'order accepted (200/201)': (r) => r.status === 200 || r.status === 201,
  })
  // 幂等与库存约束: BODY_MISMATCH(422)/库存不足(409)在压测下出现即视为异常命中
  check(res, { 'no idempotency drift (422)': (r) => r.status !== 422 })
  sleep(0.2)
}
