ARG APP=storefront-api

FROM oven/bun:1.2-alpine AS pruner
WORKDIR /app
# 全量上下文, 内部由 turbo 按真实依赖图推导子图(依赖清单 + pruned lockfile)。
# APPS 默认并集覆盖 compose 的全部 API 服务; CI 按 APP 传单个应用, 镜像更小。
# 注意 turbo prune 认的是 package.json 的包名(@epinfresh/*), 不是目录名。
ARG APPS="@epinfresh/storefront-api @epinfresh/admin-api @epinfresh/worker"
RUN bun add -g turbo@2.10.5
COPY . .
RUN turbo prune ${APPS} --docker

FROM oven/bun:1.2-alpine AS base
ARG APP
ENV APP=$APP
WORKDIR /app

# 1. 仅子图依赖清单(含 pruned lockfile)先行, 命中 Docker 缓存层
# pnpm-workspace.yaml/lockfile 在 out/ 根(out/json 里没有), 必须单独拷,
# 缺 workspace 文件则 pnpm 不建子包 node_modules 链接, 运行时解析不到传递依赖
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# pnpm 钉在与 packageManager 一致的版本: pnpm 11+ 依赖 node:sqlite, Bun 1.2 无此模块
RUN bun add -g pnpm@10.7.0 && pnpm install --frozen-lockfile --prod --ignore-scripts

# 2. 复制子图实际源码
COPY --from=pruner /app/out/full/ .

ENV NODE_ENV=production
EXPOSE 3000

USER bun

CMD ["sh", "-c", "exec bun apps/${APP}/src/index.ts"]
