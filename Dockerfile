ARG APP=api-www

FROM oven/bun:1.2-alpine AS base
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY config/tsconfig/ ./config/tsconfig/
COPY packages/ ./packages/
COPY domains/ ./domains/
COPY apps/ ./apps/

RUN bun add -g pnpm && pnpm install --frozen-lockfile --prod --ignore-scripts

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "exec bun apps/${APP}/src/index.ts"]
