# ELYSIA-2-UPGRADE.md — elysia 2.0 升级计划

> 状态: 待启动。elysia 1.2.x / eden 1.4.9 / @elysiajs/openapi 1.4.x。
> 升级是最大单一技术债偿还窗口（见 docs/tech-debt.md #1/#13/#17/#18），
> 涉及全仓 API + web 两端，需独立排期、逐步验证。

## 为什么升级

- 消除 eden treaty PATCH body `as never` workaround（tech-debt #1）
- `exact-mirror` Union 警告（`TypeCompiler is required to use Union`）
- 替换 schema 内核后确认 `uri` format 手动注册是否消失（tech-debt #13）
- 清理 `as unknown as` 逃逸（tech-debt #18）
- 若提供 Result/error 语义，替换 `isResult` 鸭子探测（tech-debt #17）

## 已知障碍

1. **eden treaty PATCH body 坍缩为 never**
   - 根因: eden 1.4.9 treaty2 `CreateParams` 交叉类型对"动态段 `:id` 子路由 + PATCH"推断失败
   - 位置: `apps/admin-web/src/libs/api/types.ts`、`_admin/users.tsx:42`、`_admin/orders/$id.tsx:142`
   - 2.0 配套 eden 2.x 已简化 `Sign` 的 body 分支，有修复可能，**需实测确认**
2. **exact-mirror Union 警告**
   - `pnpm test` 输出 `warn: [exact-mirror] TypeBox's TypeCompiler is required to use Union`
   - storefront-api ~39 次、admin-api ~33 次，由含 `Type.Union` 的 schema 触发（exact-mirror@1.2.2 handleUnion）
   - 属降级路径警告，不影响正确性；2.0 替换 schema 内核后确认是否消失

## 升级步骤（按序）

1. **读 changelog / migration guide**：elysia 2.0 正式版 + eden 2.x 发版后，先通读 breaking changes 与 1.x→2.x 迁移文档
2. **锁定版本**：将 `elysia`、`@elysiajs/eden`、`@elysiajs/cors`、`@elysiajs/openapi` 同步升到 2.x 配套版本，pnpm-lock 更新
3. **CI 先行验证**：跑 `pnpm typecheck` + `pnpm lint`，先让编译错误暴露 API 面变化
4. **逐包修复**（依赖方向自底向上）：
   - `packages/shared`（format 注册）→ `packages/http` → `packages/session` → `packages/database`（如需）
   - `apps/storefront-api` → `apps/admin-api` → worker 不动
   - `apps/storefront-web` → `apps/admin-web`
5. **逐项确认 tech-debt 消除**：
   - [ ] eden PATCH `as never` 是否可移除（改回类型化 body）→ 移除 workaround + 更新 CONTRIBUTE.md「上游依赖待验证」
   - [ ] exact-mirror Union 警告是否消失
   - [ ] `uri` format 手动注册（packages/shared/src/env.ts）是否需要保留
   - [ ] `as unknown as` 逃逸点逐处清理
   - [ ] `isResult` 是否有官方替代
6. **回归测试**：
   - `pnpm test`（全量 domain/usecase/app 测试）
   - `pnpm e2e`（Playwright 全链路，重点 admin 订单状态 PATCH、用户禁用/角色变更）
   - `pnpm typecheck && pnpm lint && pnpm check`
7. **文档同步**：CONTRIBUTE.md「上游依赖待验证」章节结清；docs/tech-debt.md 对应条目移除

## 风险与回滚

- **风险**：eden treaty 类型推断在 2.x 可能有新的破坏面；`as never` 若仍存在则保持 workaround 不动（不阻塞升级）
- **回滚**：升级独立 commit；出问题 `git revert` 该 commit（类型与运行时均已回归测试兜底）
- **分阶段**：可先只升 API 侧（elysia + 服务端），web 侧 eden 单独再升，降低一次升级面

## 检查清单（升级后逐项打勾）

- [ ] `pnpm typecheck` 全绿
- [ ] `pnpm lint` 全绿
- [ ] `pnpm test` 全绿
- [ ] `pnpm e2e` 全绿（含 admin PATCH 流程）
- [ ] eden PATCH workaround 已移除或确认仍必要
- [ ] exact-mirror Union 警告状态确认
- [ ] CONTRIBUTE.md 上游章节已更新
