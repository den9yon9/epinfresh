import { DEFAULT_LOCALE, type Locale, normalizeLocale } from '@epinfresh/i18n'
import type { TransactionalEmailTemplate } from '@epinfresh/notifications/jobs'
import type { Logger } from '@epinfresh/shared'
import type { EmailSender } from '@epinfresh/user/jobs'
import type { UserEmailTemplate } from '@epinfresh/user/jobs'
import nodemailer from 'nodemailer'

import type { WorkerEnv } from './env'
import { renderEmail } from './templates'

// 生效模板 = 用户域 ∪ 交易履约域(与 worker dispatcher 全量注册一致)
export type EmailTemplate = UserEmailTemplate | TransactionalEmailTemplate

export type MailTransport = 'console' | 'smtp'

export interface Mailer extends EmailSender {
  transport: MailTransport
}

// 任务 locale(字符串) → 受支持语言; 缺失/未知回落默认(en)
function toLocale(locale: string | undefined): Locale {
  if (!locale) return DEFAULT_LOCALE
  return normalizeLocale(locale) ?? DEFAULT_LOCALE
}

// 邮件发送 = 模板渲染 + 传输。console 模式打日志(开发/测试零配置),
// smtp 模式经 nodemailer 对接任意 SMTP 服务(阿里云邮件推送/企业邮箱等)。
export function createMailer(env: WorkerEnv, logger: Logger): Mailer {
  if (env.MAIL_TRANSPORT === 'console') {
    return {
      transport: 'console',
      async send(template, to, vars, locale) {
        // 渲染照常执行: 让模板 vars 缺失在开发期就暴露, 而不是上生产才炸
        // template 来自 EmailSender(string 端口); 渲染层按 EmailTemplate 联合收口,
        // 未知模板由 renderEmail 的 default 分支 throw (job 名与模板漂移防护)
        const rendered = renderEmail(template as EmailTemplate, vars, toLocale(locale))
        logger.info(
          { to, template, subject: rendered.subject, text: rendered.text },
          'email sent (console transport)',
        )
      },
    }
  }

  const missing = (
    ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'] as const
  ).filter((key) => env[key] === undefined)
  if (missing.length > 0) {
    throw new Error(`[ENV] MAIL_TRANSPORT=smtp requires: ${missing.join(', ')}`)
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  })

  return {
    transport: 'smtp',
    async send(
      template: EmailTemplate,
      to: string,
      vars: Record<string, unknown>,
      locale?: string,
    ) {
      const rendered = renderEmail(template, vars, toLocale(locale))
      await transport.sendMail({
        from: env.MAIL_FROM,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })
      logger.info({ to, template, subject: rendered.subject }, 'email sent (smtp transport)')
    },
  }
}
