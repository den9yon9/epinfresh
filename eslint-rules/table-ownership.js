// ESLint 本地插件: 强制 domains/* 只写本域归属的表
//
// 背景: eslint-plugin-boundaries 只约束包级 import 方向, 管不到 schema.xxx 数据表访问;
// payment 域可以合法 import '@epinfresh/database' 后 tx.update(schema.orders) 越界写订单表。
//
// 归属推导: schema 表定义按域分目录(见 packages/database/src/schema/), 目录名即归属域。
// 规则扫描该目录下所有 .ts, 凡 `export const <name> = pgTable(` 的表, 归属 = 所在目录名。
// 新增表只需放到正确域目录并同步 index.ts 导出, 规则零维护。
//
// 只检查"写操作目标"(update/insert/delete 的实参表), 读操作(select/join)放行——
// 跨域读是合法关联(如 cart join product 展示详情), 只有跨域写才是越界。
'use strict'

import { readdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
/** 表定义文件所在根目录(相对本规则文件) */
const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url)) + '/../packages/database/src/schema'

/** 表名 → 归属域; 惰性加载缓存 */
let tableOwnership = null

function loadTableOwnership() {
  if (tableOwnership) return tableOwnership
  tableOwnership = new Map()

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(`${dir}/${entry.name}`)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      const src = readFileSync(`${dir}/${entry.name}`, 'utf8')
      // 表定义特征: export const <name> = pgTable(
      const re = /export const (\w+) = pgTable\(/g
      for (const match of src.matchAll(re)) {
        // 目录名即归属域; 根目录文件(如 relations.ts)不含表定义, 天然被过滤
        const domain = dir.split('/').pop()
        if (domain !== 'schema') tableOwnership.set(match[1], domain)
      }
    }
  }
  walk(SCHEMA_DIR)
  return tableOwnership
}

function extractDomainFromFilename(filename) {
  const match = /\/domains\/([^/]+)\//.exec(filename)
  return match ? match[1] : null
}

/** 写操作的方法名; Drizzle 的 insert/update/delete 首个实参即目标表 */
const WRITE_METHODS = new Set(['insert', 'update', 'delete'])

/** 解析实参里的 schema.<表> 引用; 直接形参或数组元素均可 */
function* schemaTableRefs(arg) {
  if (!arg) return
  if (arg.type === 'MemberExpression' && arg.object?.name === 'schema') {
    yield arg
    return
  }
  if (arg.type === 'ArrayExpression') {
    for (const el of arg.elements) {
      if (el?.type === 'MemberExpression' && el.object?.name === 'schema') yield el
    }
  }
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid domain code from writing tables owned by another domain',
    },
    messages: {
      crossDomain:
        'Writing table "schema.{{table}}" (owned by the "{{owner}}" domain) from the "{{domain}}" domain is forbidden. Cross-domain orchestration belongs in usecases/; keep writes within the owning domain.',
    },
  },
  create(context) {
    const domain = extractDomainFromFilename(context.filename)
    if (domain === null) return {}

    const ownership = loadTableOwnership()

    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') return
        if (!WRITE_METHODS.has(callee.property.name)) return

        for (const ref of schemaTableRefs(node.arguments[0])) {
          const tableName = ref.property.name
          const owner = ownership.get(tableName)
          if (owner === undefined || owner === domain) continue

          context.report({
            node: ref,
            messageId: 'crossDomain',
            data: { table: tableName, owner, domain },
          })
        }
      },
    }
  },
}

export default { rules: { 'no-cross-domain-tables': rule } }
