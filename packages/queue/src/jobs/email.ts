import { type Job, createQueue, createWorker } from '../index'

export interface SendEmailJobData {
  type: 'welcome' | 'reset-password'
  to: string
  payload: Record<string, unknown>
}

export const EMAIL_QUEUE_NAME = 'email-tasks'

export const emailQueue = createQueue<SendEmailJobData>(EMAIL_QUEUE_NAME)

export function registerEmailWorker(handler?: (job: Job<SendEmailJobData>) => Promise<void>) {
  return createWorker<SendEmailJobData>(EMAIL_QUEUE_NAME, async (job) => {
    if (handler) {
      await handler(job)
      return
    }

    switch (job.data.type) {
      case 'welcome':
        console.log(`[Queue] 📧 发送欢迎邮件给: ${job.data.to}`, job.data.payload)
        break
      default:
        console.warn(`[Queue] 未知邮件任务类型: ${job.data.type}`)
    }
  })
}
