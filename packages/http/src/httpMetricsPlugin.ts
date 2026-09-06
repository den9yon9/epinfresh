import { Elysia } from 'elysia'

import { type HttpMetricsRecorder, recordHttpRequest } from './metrics'

// request → 开始时刻(WeakMap 免 store 类型负担, 请求对象生命周期受限)
const starts = new WeakMap<Request, number>()

function toStatus(status: unknown, fallback: number): number {
  return typeof status === 'number' ? status : fallback
}

// HTTP 指标插件: onRequest 记开始时刻 → onAfterHandle/onError 记状态码与耗时。
// path 取路由模板(如 /orders/:id), 天然归一, 无动态段基数爆炸问题。
// 挂载顺序: 指标插件应在最外层, 才能覆盖所有下游路由。
export function httpMetricsPlugin(metrics: HttpMetricsRecorder) {
  return (
    new Elysia({ name: 'http-metrics' })
      .onRequest(({ request }) => {
        starts.set(request, performance.now())
      })
      // as: 'global' 是关键: 钩子需作用于所有下游路由(见 requestLogger 同款写法),
      // 否则本插件被 .use() 后钩子默认 scoped 到无路由的插件自身, 永不触发 → 指标恒为 0。
      .onAfterHandle({ as: 'global' }, ({ request, path, set }) => {
        const start = starts.get(request)
        recordHttpRequest(metrics, {
          method: request.method,
          path,
          status: toStatus(set.status, 200),
          durationMs: start === undefined ? 0 : performance.now() - start,
        })
      })
      .onError({ as: 'global' }, ({ request, path, set }) => {
        const start = starts.get(request)
        recordHttpRequest(metrics, {
          method: request.method,
          path,
          status: toStatus(set.status, 500),
          durationMs: start === undefined ? 0 : performance.now() - start,
        })
      })
  )
}
