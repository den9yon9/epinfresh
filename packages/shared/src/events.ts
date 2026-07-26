import mitt from 'mitt'

export type ApplicationEvents = {
  'user:registered': {
    userId: string
    email: string
    name: string | null
    createdAt: Date
  }
}

/**
 * -----------------------------------------------------------------------------
 * In-Process Event Bus (mitt)
 * -----------------------------------------------------------------------------
 * ⚠️ ARCHITECTURAL LIMITATION & GUIDANCE:
 *
 * 1. Scope:
 *    This Event Bus uses `mitt` and works ONLY WITHIN A SINGLE OS PROCESS (in-memory).
 *
 * 2. Multi-Process Limitation:
 *    Events emitted in `api-storefront` WILL NOT be received by `api-admin`,
 *    because they run in separate Node.js / Bun OS processes / Docker containers.
 *
 * 3. When to Upgrade:
 *    - For Cross-Process Notifications (e.g. Admin updating product -> Storefront invalidates cache):
 *      => Upgrade to Redis Pub/Sub (`redis.publish` / `redis.subscribe`).
 *    - For Reliable Async Background Jobs (e.g. Sending emails, payment webhooks, retries):
 *      => Upgrade to BullMQ (backed by Redis Streams).
 * -----------------------------------------------------------------------------
 */
export const eventBus = mitt<ApplicationEvents>()
