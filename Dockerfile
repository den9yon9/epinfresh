ARG APP=storefront-api

FROM oven/bun:1.2-alpine AS pruner
WORKDIR /app
# 全量上下文, 内部由 turbo 按真实依赖图推导子图(依赖清单 + pruned lockfile)。
# APPS 默认并集覆盖 compose 的全部 API 服务; CI 按 APP 传单个应用, 镜像更小。
ARG APPS="storefront-api admin-api worker"
RUN bun add -g turbo@2.10.5
COPY . .
RUN turbo prune ${APPS} --docker

FROM oven/bun:1.2-alpine AS base
ARG APP
ENV APP=$APP
WORKDIR /app

# 1. 仅子图依赖清单(含 pruned lockfile)先行, 命中 Docker 缓存层
COPY --from=pruner /app/out/json/ .

RUN bun add -g pnpm && pnpm install --frozen-lockfile --prod --ignore-scripts

# 2. 复制子图实际源码
COPY --from=pruner /app/out/full/ .

ENV NODE_ENV=production
EXPOSE 3000

USER bun

CMD ["sh", "-c", "exec bun apps/${APP}/src/index.ts"]
