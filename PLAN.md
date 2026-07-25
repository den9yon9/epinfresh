# epinfresh 修复计划

基于全仓库审计的修复路线图,分 4 批推进,每批可独立 PR。

---

## 第 1 批:安全 / 数据正确性(必须)

| # | 问题 | 位置 | 方案 |
|---|------|------|------|
| 1.1 | CORS 默认 `*` + `credentials: true` | `apps/api-www/src/index.ts:25`、`apps/api-admin/src/index.ts:25`、`shared/src/env.ts` | 默认改为拒绝通配;`NODE_ENV=production` 时禁止 `*`/`true` 与 credentials 组合 |
| 1.2 | `SESSION_SECRET` 校验却从未使用,session 未签名 | `shared/src/env.ts:7`、`domains/session/src/sessionPlugin.ts` | 用 `SESSION_SECRET` 对 session ID 做 HMAC 签名,cookie 存 `id.signature`,读取时校验 |
| 1.3 | `ProductService.create` 静默丢弃 `images`/`status`/SKU `attributes`/`stock` | `domains/product/src/service.ts:45-72` | insert 时补齐这些字段 |
| 1.4 | DB 唯一/FK 约束违规 → 500 | `domains/user/src/service.ts`、`domains/product/src/service.ts` | 捕获 Postgres `23505`(unique)/`23503`(fk)→ 返回 `409`/`400` |
| 1.5 | `categoryId`/`parentId` 写入未校验 UUID | `packages/database/src/model.ts:27,32` | 加 `format: 'uuid'` |
| 1.6 | Admin `/docs` 公开暴露 | `apps/api-admin/src/index.ts:27-33` | 生产环境关闭 docs,或加鉴权 |
| 1.7 | 优雅退出 exit code 错误 + 无超时 | `apps/api-www/src/index.ts:42-54`、`apps/api-admin/src/index.ts:47-57` | catch 退出非 0;加 force-kill 超时 |

---

## 第 2 批:架构 / 一致性

- 引入 `bun:test` + 关键 service/route 测试 + CI test step
- `db` 全局单例改可注入(或定 module-mock 测试方案)
- admin 改用 `isAdmin` 宏,删除手写 `onBeforeHandle` 守卫与死代码
- 补齐 admin 路由 response schema(401/403)
- 统一 `Result` 策略(create/list/listCategories/createCategory 也返回 Result)
- 全部日志走 pino,移除 `console.*`
- `SessionSchema` role 改动态 map
- admin 路由补 `detail.tags`

---

## 第 3 批:基础设施

- 补 README + LICENSE
- App Dockerfile + compose healthcheck + app 服务 + Redis 持久化卷
- CI 补 test/migrate/audit;加 CD deploy workflow
- commitlint 纳入 CI
- 补索引:`users.createdAt`、`categories.parentId`、`categories.sortOrder`
- `listCategories` 分页
- `turbo.json` 加 `lint`/`test`/`clean` task
- 请求体大小限制 + 安全响应头中间件
- `trustProxy` 改 env 驱动
- admin API 加限流

---

## 第 4 批:清理

- 死代码清理:`isAdmin` 宏(改用后此项消失)、`Transaction`/`TypedDb` 导出
- vestigial build:统一 `main`/`types` 指向,或移除无消费方的 `dist/`
- `.gitignore` 补 `.DS_Store`/`.idea`/`.vscode`
- `DUMMY_HASH` 顶层 await 延迟到首次 login
- `register` 邮箱归一化(lower + trim)
- `UserService.list/getById` 显式排除 `passwordHash` 列
- `ProductService.remove` 移除手动删 SKU(FK 已 cascade)
- `commonModel` 去重注册
- 移除 CI 中未使用的 `setup-bun`

---

## 进度跟踪

- [x] 第 1 批
- [ ] 第 2 批
- [ ] 第 3 批
- [ ] 第 4 批
