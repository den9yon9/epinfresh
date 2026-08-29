import type { Logger } from '@epinfresh/shared'
import type { EmailSender, EmailTemplate } from '@epinfresh/user/jobs'
import nodemailer from 'nodemailer'

import type { WorkerEnv } from './env'
import { renderEmail } from './templates'

export type MailTransport = 'console' | 'smtp'

export interface Mailer extends EmailSender {
  transport: MailTransport
}

// 邮件发送 = 模板渲染 + 传输。console 模式打日志(开发/测试零配置),
// smtp 模式经 nodemailer 对接任意 SMTP 服务(阿里云邮件推送/企业邮箱等)。
export function createMailer(env: WorkerEnv, logger: Logger): Mailer {
  if (env.MAIL_TRANSPORT === 'console') {
    return {
      transport: 'console',
      async send(template, to, vars) {
        // 渲染照常执行: 让模板 vars 缺失在开发期就暴露, 而不是上生产才炸
        const rendered = renderEmail(template, vars)
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
    async send(template: EmailTemplate, to: string, vars: Record<string, unknown>) {
      const rendered = renderEmail(template, vars)
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
