import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry as PrometheusRegistry,
  type Registry,
} from 'prom-client'

export { Counter, Gauge, Histogram }
export type { Registry }

// 每个服务/app 实例独立 Registry: 隔离同名 metric 注册冲突
// (生产单实例; 测试同进程多 buildApp 共存)。
// 运行时指标(内存/句柄)采集一次: 挂在首个 registry, 后续实例仅业务/HTTP 指标。
let defaultMetricsCollected = false

export function createMetrics(): Registry {
  const registry: Registry = new PrometheusRegistry()
  if (!defaultMetricsCollected) {
    try {
      collectDefaultMetrics({ register: registry })
    } catch {
      // collectDefaultMetrics 在重复进程内失败时降级空指示(生产单实例不会触发)
    }
    defaultMetricsCollected = true
  }
  return registry
}

export interface HttpMetricsBundle {
  httpRequests: Counter<string>
  httpRequestDuration: Histogram<string>
}

// 与 HttpMetricsBundle 同形状(名称语义区分: 录制侧/装配侧)
export type HttpMetricsRecorder = HttpMetricsBundle

const LABELS = ['method', 'path', 'status'] as const

export function registerHttpMetrics(metrics: Registry): HttpMetricsBundle {
  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests processed',
    labelNames: LABELS,
    registers: [metrics],
  })
  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'path'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [metrics],
  })
  return { httpRequests, httpRequestDuration }
}

// 业务计数: 支付回调验签等关键路径按 app 实例注册, 与 HTTP 指标共享 Registry
export function registerBusinessMetric(
  metrics: Registry,
  name: string,
  help: string,
  labels: string[] = [],
): Counter<string> {
  return new Counter({ name, help, labelNames: labels, registers: [metrics] })
}

// 渲染 Prometheus 文本(供 /metrics 端点响应体); v15 metrics() 为异步
export async function renderMetrics(metrics: Registry): Promise<string> {
  return metrics.metrics()
}

// 归一化路径: URL 形态的动态段(uuid)替换为 :id, 防标签基数爆炸
export function metricPath(pathname: string): string {
  return pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/g, '/:id')
}

// 单个 HTTP 请求指标包装: 状态码 + 耗时
export function recordHttpRequest(
  recorder: HttpMetricsRecorder,
  params: { method: string; path: string; status: number; durationMs: number },
) {
  const path = metricPath(params.path)
  recorder.httpRequests.inc({ method: params.method, path, status: String(params.status) })
  recorder.httpRequestDuration.observe({ method: params.method, path }, params.durationMs / 1000)
}
