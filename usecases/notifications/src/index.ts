export {
  type EmailQueuePort,
  type OrderEmailDeps,
  type OutboxEventLike,
  sendOrderShippedEmail,
  sendPaymentSucceededEmail,
  sendRefundSucceededEmail,
} from './service'
