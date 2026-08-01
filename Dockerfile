ARG APP=api-storefront

FROM oven/bun:1.2-alpine AS base
WORKDIR /app

# 1. 优先复制依赖清单，利用 Docker 缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY domains/product/package.json ./domains/product/
COPY packages/session/package.json ./packages/session/
COPY packages/queue/package.json ./packages/queue/
COPY domains/user/package.json ./domains/user/
COPY apps/api-storefront/package.json ./apps/api-storefront/
COPY apps/api-admin/package.json ./apps/api-admin/
COPY apps/worker/package.json ./apps/worker/

RUN bun add -g pnpm && pnpm install --frozen-lockfile --prod --ignore-scripts

# 2. 复制实际源码
COPY packages/tsconfig/ ./packages/tsconfig/
COPY packages/ ./packages/
COPY domains/ ./domains/
COPY apps/ ./apps/

ENV NODE_ENV=production
EXPOSE 3000

USER bun

CMD ["sh", "-c", "exec bun apps/${APP}/src/index.ts"]
