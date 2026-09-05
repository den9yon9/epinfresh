import { createLogger } from '@epinfresh/shared'
import { describe, expect, test } from 'bun:test'

import { createUserEmailHandlers } from './handlers'
import { EMAIL_JOB_NAMES, type EmailSender } from './jobs'

const logger = createLogger('silent')

function createFakeSender() {
  const sent: { template: string; to: string; vars: Record<string, unknown> }[] = []
  const sender: EmailSender = {
    async send(template, to, vars) {
      sent.push({ template, to, vars })
    },
  }
  return { sender, sent }
}

describe('createUserEmailHandlers', () => {
  test('welcome handler forwards payload vars to the sender', async () => {
    const { sender, sent } = createFakeSender()
    const handlers = createUserEmailHandlers(sender, { webBaseUrl: 'http://web.test' })

    await handlers[EMAIL_JOB_NAMES.WELCOME](
      { to: 'a@b.com', payload: { userId: 'u1', name: '小明' } },
      logger,
    )

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ template: 'welcome', to: 'a@b.com', vars: { name: '小明' } })
  })

  test('reset-password handler builds the reset link from webBaseUrl', async () => {
    const { sender, sent } = createFakeSender()
    const handlers = createUserEmailHandlers(sender, { webBaseUrl: 'http://web.test' })

    await handlers[EMAIL_JOB_NAMES.RESET_PASSWORD](
      { to: 'a@b.com', payload: { token: 'tok-1' } },
      logger,
    )

    expect(sent[0].template).toBe('reset-password')
    expect(sent[0].vars.resetLink).toBe('http://web.test/reset-password?token=tok-1')
  })

  test('reset-password handler rejects a missing token (job retry path)', async () => {
    const { sender, sent } = createFakeSender()
    const handlers = createUserEmailHandlers(sender, { webBaseUrl: 'http://web.test' })

    // 同步抛错 → dispatcher 捕获 → job 失败进 BullMQ 重试
    expect(() =>
      handlers[EMAIL_JOB_NAMES.RESET_PASSWORD]({ to: 'a@b.com', payload: {} }, logger),
    ).toThrow(/token/)
    expect(sent).toHaveLength(0)
  })
})
