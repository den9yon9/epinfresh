# epinfresh

E-commerce backend monorepo — ElysiaJS + Drizzle ORM + Bun.

## Tech Stack

- **Runtime:** Bun ≥1.2, Node ≥22
- **Framework:** ElysiaJS 1.2
- **ORM:** Drizzle ORM 0.40 (PostgreSQL via `postgres-js`)
- **Validation:** TypeBox / `drizzle-typebox`
- **Session:** Redis-backed (ioredis), HMAC-signed cookies
- **Monorepo:** pnpm workspaces + Turborepo 2.10
- **Lint/Format:** Biome 1.9
- **CI:** GitHub Actions

## Architecture

```
apps/
├── api-storefront/     → Public storefront API (port 3000)
└── api-admin/   → Admin API (port 3001)
domains/
├── product/     → Product/category CRUD
├── session/     → Redis auth, rate limiting
└── user/        → Registration, login, user CRUD
packages/
├── database/    → Drizzle schema, migrations, connection
└── shared/      → Env validation, logger, common schemas
```

Apps are thin shells; routes and business logic live in domain packages.

## Prerequisites

- [Bun](https://bun.sh) ≥1.2
- [Docker](https://docker.com) + [Docker Compose](https://docs.docker.com/compose/)

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment
cp .env.example .env

# Start infra (PostgreSQL + Redis)
docker compose -f docker/docker-compose.yml up -d

# Run migrations
pnpm dev  # runs migrate before dev server
# or standalone: pnpm --filter @epinfresh/database db:migrate
```

## Development

```bash
# Start both APIs with hot-reload
pnpm dev

# Or start individually
bun --watch apps/api-storefront/src/index.ts     # Storefront API :3000
bun --watch apps/api-admin/src/index.ts  # Admin API :3001
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Migrate + start all dev servers |
| `pnpm build` | TypeScript compile all packages |
| `pnpm typecheck` | Type check without emit |
| `pnpm lint` | Biome lint & format check |
| `pnpm format` | Biome auto-format |
| `pnpm check` | CI: lint + format (read-only) |
| `pnpm clean` | Remove dist & .turbo artifacts |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `SESSION_SECRET` | — | HMAC key for session cookies (min 32 chars) |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `CORS_ORIGIN` | `*` | Allowed origin(s) for CORS |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for rate limiting |
| `STOREFRONT_PORT` | `3000` | Storefront API port |
| `ADMIN_PORT` | `3001` | Admin API port |

## Docker

```bash
# Build production image
docker build --build-arg APP=api-storefront -t epinfresh-storefront .

# Run with compose (includes healthchecks)
docker compose -f docker/docker-compose.yml up -d
```
