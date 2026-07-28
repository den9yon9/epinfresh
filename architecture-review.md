# Architecture Review — Epinfresh

## Overview

Monorepo e-commerce backend: Bun + ElysiaJS + Drizzle ORM + PostgreSQL + Redis + BullMQ.

DDD-style structure: `packages/` (infra) → `domains/` (business) → `workflows/` (cross-domain) → `apps/` (entry points). ESLint boundaries enforces the dependency graph.

---

## Strengths

- **Module boundaries clear**: `packages` → `domains` → `workflows` → `apps`, enforced by `eslint-plugin-boundaries`
- **TypeBox full-pipeline validation**: HTTP input validated at the boundary, typed through to service layer via `InferModelsMap`
- **Result pattern**: `neverthrow` `Result<T,E>` for business errors; Elysia macros for auth guards (`isAuth` / `isAdmin`)
- **Security details**: Pino log redaction for auth/cookie headers; constant-time dummy-hash comparison in login (user enumeration prevention); argon2id password hashing
- **Ops mature**: graceful shutdown with 10s force-kill deadline; env validation at startup with clear error messages; Docker Compose full local stack; health endpoints

---

## Security (fix first)

### 1. Session Fixation
**File:** `packages/session/src/sessionPlugin.ts`

Login does not regenerate the session ID. If an attacker plants a known `session_id` cookie, it becomes authenticated after the victim logs in.

**Fix:** Call `sessionStore.destroy(oldSessionId)` before `sessionStore.create(...)` on login, or add a `regenerate()` method to `SessionStore`.

### 2. `secure` cookie flag not enforced
**File:** `packages/session/src/sessionPlugin.ts`

`setSessionCookie` delegates `secure` to the caller. A consumer could accidentally pass `false` in production, leaking session cookies over HTTP. `clearSessionCookie` omits `secure` entirely — clearing a secure cookie without the flag may fail.

**Fix:** Enforce `secure: ${NODE_ENV === 'production'}` internally in both functions.

### 3. SameSite logic inverted
**File:** `packages/session/src/sessionPlugin.ts`

Production uses `lax`, development uses `strict`. This means the CSRF posture differs between environments — you cannot reproduce the production CSRF behavior in development.

**Fix:** Use the same value in both environments, or `strict` in production.

---

## Architecture

### 4. `initDb` / `initRedis` race condition
**Files:** `packages/database/src/index.ts:54-74`, `packages/session/src/redis.ts:24-32`

Both use a check-then-act singleton. Concurrent calls can both pass the `if (!instance)` guard and create duplicate connection pools, leaking the first one.

**Fix:** Guard with a promise lock:

```ts
let initPromise: Promise<InitResult> | null = null
export function initDb(...) {
  if (initPromise) return initPromise
  initPromise = actuallyInit()
  return initPromise
}
```

### 5. N+1 queries in product listing
**File:** `domains/product/src/service.ts` (`listAllProducts`, `listPublishedProducts`)

`db.query.products.findMany({ with: { skus: true } })` may issue a separate query per product for SKUs in Drizzle's current `findMany` implementation. 20 products = 21 queries.

**Fix:** Verify Drizzle's SQL output. If N+1, use a join-based query or a single batch SKU query.

### 6. 85% boilerplate duplication between API apps
**Files:** `apps/api-storefront/src/index.ts`, `apps/api-admin/src/index.ts`

Both apps share the same bootstrap sequence (`loadEnv → initDb → initRedis → middleware chain → plugins → health → listen`), the same CORS config, the same `onError` handler, and a near-identical `shutdown()` function.

**Fix:** Extract a `createApiApp(options)` factory in `packages/shared`:

```ts
createApiApp({
  port: env.STOREFRONT_PORT,
  plugins: [userStorefrontPlugin, productStorefrontPlugin, checkoutPlugin],
  enableDocs: true,
})
```

### 7. Pagination logic copied 3 times
**Files:** `domains/product/src/service.ts` (`listAllProducts`, `listCategories`), `domains/user/src/service.ts` (`listUsers`)

Identical `(page - 1) * pageSize` + `select({ count })` + `limit/offset` pattern repeated.

**Fix:** Extract a `paginate(db, table, opts)` helper in shared.

---

## Code Quality

### 8. Inconsistent Result usage — unhandled DB errors become 500
**Files:** `domains/user/src/service.ts` (`registerUser`), `domains/product/src/service.ts` (`createProduct`, `createCategory`)

These write operations return raw data instead of `Result`. Unique constraint violations (duplicate email, duplicate slug) throw uncaught exceptions → HTTP 500 instead of a friendly 4xx error.

**Fix:** Either wrap in `Result` or use try/catch with `mapDbError` from shared.

### 9. `updateProduct` includes dead transaction query
**File:** `domains/product/src/service.ts`

The transaction runs `UPDATE ... RETURNING` (which gives the updated product), then also runs a `SELECT` for SKUs — but `updateProduct` never modifies SKUs.

**Fix:** Remove the SKU re-fetch inside the transaction.

### 10. `RegisterInput.email` missing `format: 'email'`
**File:** `domains/user/src/model.ts`

`LoginInput.email` has `format: 'email'`, `RegisterInput.email` does not. Invalid emails reach the database.

**Fix:** Add `t.String({ format: 'email' })` to the register schema.

### 11. `reduceProductStock` TOCTOU race
**File:** `domains/product/src/service.ts:54-76`

The update with `gte(stock, quantity)` guard is atomic. But when it returns 0 rows, a second SELECT outside a transaction disambiguates `SKU_NOT_FOUND` vs `INSUFFICIENT_STOCK`. Another thread can insert/restock between the two queries, returning the wrong error code.

**Fix:** Wrap in a transaction, or check existence before the guarded update within the same transaction.

---

## Low Priority / Nitpicks

- **No tests**: Zero test files in the repository. At minimum, core paths (login, checkout, stock reduction) should have integration tests.
- **Dead code**: `LogLevel` type and `ALLOWED` Set in `packages/shared/src/logger.ts` are declared but unused.
- **CSP header missing**: `securityHeaders.ts` sets `nosniff`, `DENY`, HSTS, referrer-policy, but omits `Content-Security-Policy`.
- **`db` Proxy missing traps**: Only `get` is trapped. `set`, `has`, `ownKeys` bypass the guard. `Object.keys(db)` or `delete db.xxx` interact with the empty proxy target.
- **`neverthrow` direct dependency**: `domains/product/package.json` and `domains/user/package.json` list `neverthrow` as a direct dependency, but all imports go through `@epinfresh/shared`.
- **Worker missing shutdown timeout**: API apps have a 10s force-kill deadline; the worker does not.
- **No bootstrap health check**: `initDb`/`initRedis` succeed eagerly; a down database is only detected at the first request.
- **No secret rotation**: `SESSION_SECRET` is a single value. Rotating it invalidates all sessions.
- **`listCategories` loose type**: Service signature is `{page: number; pageSize: number}` instead of the model's `CategoryListQuery`.
- **Single Redis for sessions + rate limiting**: Rate-limit key eviction competes with session data for memory and CPU.
- **No idle/sliding session expiry**: Session expires exactly 24h after creation regardless of activity.
- **Session data stored as plain JSON in Redis**: No encryption at rest.

---

## Summary

Strong foundation: type-safe stack, clean domain separation, mature ops tooling. The main gaps are:

1. **Session fixation** + **cookie flag hygiene** (security)
2. **Connection pool race** in initDb/initRedis (reliability)
3. **Inconsistent error handling** on write operations (robustness)
4. **Missing tests** (confidence)

All are low-effort to fix given the codebase size.
