import { parseEnv } from '@epinfresh/shared'
import { type StaticDecode, Type } from '@sinclair/typebox'

export const workerEnvSchema = Type.Object({
  NODE_ENV: Type.Union(
    [Type.Literal('development'), Type.Literal('production'), Type.Literal('test')],
    { default: 'development' },
  ),
  LOG_LEVEL: Type.Union(
    [
      Type.Literal('debug'),
      Type.Literal('info'),
      Type.Literal('warn'),
      Type.Literal('error'),
      Type.Literal('silent'),
    ],
    { default: 'info' },
  ),
  REDIS_URL: Type.String({ format: 'uri' }),
  DATABASE_URL: Type.String({ format: 'uri' }),

  // 邮件传输: console 只打日志(开发/测试默认), smtp 走 nodemailer(生产)
  MAIL_TRANSPORT: Type.Union([Type.Literal('console'), Type.Literal('smtp')], {
    default: 'console',
  }),
  SMTP_HOST: Type.Optional(Type.String()),
  SMTP_PORT: Type.Optional(Type.Number()),
  SMTP_USER: Type.Optional(Type.String()),
  SMTP_PASS: Type.Optional(Type.String()),
  MAIL_FROM: Type.Optional(Type.String()),
  // 找回密码邮件的重置链接指向 storefront-web
  STOREFRONT_WEB_URL: Type.String({ format: 'uri', default: 'http://localhost:5173' }),

  // 轨迹轮询间隔(ms, 字符串数字); e2e 置小加速签收自动完成
  LOGISTICS_POLL_INTERVAL_MS: Type.String({ pattern: '^\\d+$', default: '600000' }),
  // 超时未支付关单时长(分钟, 字符串数字); 默认 15 分钟
  ORDER_AUTO_CANCEL_TIMEOUT_MINUTES: Type.String({ pattern: '^\\d+$', default: '15' }),
  // 超时未支付扫描间隔(ms, 字符串数字); 默认 60000ms
  ORDER_AUTO_CANCEL_INTERVAL_MS: Type.String({ pattern: '^\\d+$', default: '60000' }),
  // 可选健康端口: 设置后起一个极简 HTTP /health(容器健康检查与 e2e 就绪探测用)
  HEALTH_PORT: Type.Optional(Type.String({ pattern: '^\\d+$' })),
})

export type WorkerEnv = StaticDecode<typeof workerEnvSchema>

export function createEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source)
}
