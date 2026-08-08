ARG APP=storefront-api

FROM oven/bun:1.2-alpine AS base
ARG APP
ENV APP=$APP
WORKDIR /app

# 1. 优先复制依赖清单，利用 Docker 缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/database/package.json ./packages/database/
COPY packages/shared/package.json ./packages/shared/
COPY packages/http/package.json ./packages/http/
COPY packages/session/package.json ./packages/session/
COPY packages/queue/package.json ./packages/queue/
COPY packages/redis/package.json ./packages/redis/
COPY domains/product/package.json ./domains/product/
COPY domains/order/package.json ./domains/order/
COPY domains/payment/package.json ./domains/payment/
COPY domains/user/package.json ./domains/user/
COPY usecases/checkout/package.json ./usecases/checkout/
COPY usecases/order-cancel/package.json ./usecases/order-cancel/
COPY apps/storefront-api/package.json ./apps/storefront-api/
COPY apps/admin-api/package.json ./apps/admin-api/
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
