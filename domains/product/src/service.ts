import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import {
  and,
  asc,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm'

import type {
  AdminProductListQuerySchema,
  CreateCategoryInputSchema,
  CreateProductInputSchema,
  ProductListQuerySchema,
  UpdateCategoryInputSchema,
  UpdateProductInputSchema,
} from './model'

export async function listAllProducts(
  query: Static<typeof AdminProductListQuerySchema> & { q?: string },
  client: DbClient,
) {
  const { page, pageSize } = query
  const offset = (page - 1) * pageSize

  const filters: SQL[] = []
  if (query.categoryId) filters.push(eq(schema.products.categoryId, query.categoryId))
  if (query.status) filters.push(eq(schema.products.status, query.status))
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`
    filters.push(ilike(schema.products.name, pattern))
  }
  const where = filters.length > 0 ? and(...filters) : undefined

  const items = await client.query.products.findMany({
    where,
    orderBy: (products, { asc }) => asc(products.createdAt),
    limit: pageSize,
    offset,
  })
  const withSkus = await attachSkus(items, client)
  const [{ total }] = await client.select({ total: count() }).from(schema.products).where(where)
  return { items: withSkus, total: Number(total), page, pageSize }
}

type ProductSkuRow = typeof schema.productSkus.$inferSelect

async function attachSkus<T extends { id: string }>(products: T[], client: DbClient) {
  if (products.length === 0) return []
  const skus = await client
    .select()
    .from(schema.productSkus)
    .where(
      and(
        inArray(
          schema.productSkus.productId,
          products.map((p) => p.id),
        ),
        isNull(schema.productSkus.deletedAt),
      ),
    )
    .orderBy(asc(schema.productSkus.createdAt))
  const byProduct = new Map<string, ProductSkuRow[]>()
  for (const sku of skus) {
    const list = byProduct.get(sku.productId)
    if (list) list.push(sku)
    else byProduct.set(sku.productId, [sku])
  }
  return products.map((product) => ({ ...product, skus: byProduct.get(product.id) ?? [] }))
}

export function listPublishedProducts(
  query: Static<typeof ProductListQuerySchema>,
  client: DbClient,
) {
  return listAllProducts({ ...query, status: 'published' }, client)
}

export async function getProductById(id: string, client: DbClient) {
  const product = await client.query.products.findFirst({
    where: eq(schema.products.id, id),
  })
  if (!product) return err('PRODUCT_NOT_FOUND')
  const [withSkus] = await attachSkus([product], client)
  return ok(withSkus)
}

export async function getProductByIdPublic(id: string, client: DbClient) {
  const product = await client.query.products.findFirst({
    where: and(eq(schema.products.id, id), eq(schema.products.status, 'published')),
  })
  if (!product) return err('PRODUCT_NOT_FOUND')
  const [withSkus] = await attachSkus([product], client)
  return ok(withSkus)
}

export async function getSkusByIds(skuIds: string[], client: DbClient) {
  if (skuIds.length === 0) return []
  return client.query.productSkus.findMany({
    where: and(inArray(schema.productSkus.id, skuIds), isNull(schema.productSkus.deletedAt)),
    with: { product: true },
  })
}

// 可购性校验快照(轻量): SKU 存在性 + 所属商品状态。加购等编排层校验用。
export async function getSkuPurchaseInfo(
  skuId: string,
  client: DbClient,
): Promise<Result<{ productId: string; productStatus: string }, 'SKU_NOT_FOUND'>> {
  const [sku] = await client
    .select({
      productId: schema.productSkus.productId,
      productStatus: schema.products.status,
    })
    .from(schema.productSkus)
    .innerJoin(schema.products, eq(schema.productSkus.productId, schema.products.id))
    .where(and(eq(schema.productSkus.id, skuId), isNull(schema.productSkus.deletedAt)))
  if (!sku) return err('SKU_NOT_FOUND')
  return ok(sku)
}

// SKU 展示视图: SKU 简报 + 所属商品简报。批量取, 供购物车等读模型编排层拼装。
export interface SkuView {
  skuId: string
  name: string
  skuCode: string
  price: string
  stock: number
  attributes: Record<string, string>
  productId: string
  productName: string
  slug: string
  images: string[]
  productStatus: string
}

export async function getSkuViewsByIds(skuIds: string[], client: DbClient): Promise<SkuView[]> {
  if (skuIds.length === 0) return []
  return client
    .select({
      skuId: schema.productSkus.id,
      name: schema.productSkus.name,
      skuCode: schema.productSkus.skuCode,
      price: schema.productSkus.price,
      stock: schema.productSkus.stock,
      attributes: schema.productSkus.attributes,
      productId: schema.products.id,
      productName: schema.products.name,
      slug: schema.products.slug,
      images: schema.products.images,
      productStatus: schema.products.status,
    })
    .from(schema.productSkus)
    .innerJoin(schema.products, eq(schema.productSkus.productId, schema.products.id))
    .where(inArray(schema.productSkus.id, skuIds))
}

export async function reduceProductStock(
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<
  Result<void, 'SKU_NOT_FOUND' | { code: 'INSUFFICIENT_STOCK'; skuId: string; available: number }>
> {
  const updated = await client
    .update(schema.productSkus)
    .set({
      stock: sql`${schema.productSkus.stock} - ${quantity}`,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.productSkus.id, skuId), gte(schema.productSkus.stock, quantity)))
    .returning()

  if (updated.length === 0) {
    const sku = await client.query.productSkus.findFirst({
      where: eq(schema.productSkus.id, skuId),
    })
    if (!sku) return err('SKU_NOT_FOUND')
    return err({ code: 'INSUFFICIENT_STOCK', skuId: sku.id, available: Number(sku.stock) })
  }
  return ok()
}

export async function restoreProductStock(
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<void, 'SKU_NOT_FOUND'>> {
  const [updated] = await client
    .update(schema.productSkus)
    .set({
      stock: sql`${schema.productSkus.stock} + ${quantity}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.productSkus.id, skuId))
    .returning()
  if (!updated) return err('SKU_NOT_FOUND')
  return ok()
}

export async function createProduct(
  input: Static<typeof CreateProductInputSchema>,
  client: DbClient,
) {
  return withTransaction(client, async (tx) => {
    const [product] = await tx
      .insert(schema.products)
      .values({
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        categoryId: input.categoryId ?? null,
        images: input.images ?? [],
        status: input.status ?? 'draft',
      })
      .returning()
    if (input.skus && input.skus.length > 0) {
      await tx.insert(schema.productSkus).values(
        input.skus.map((sku) => ({
          productId: product.id,
          name: sku.name,
          skuCode: sku.skuCode,
          price: String(sku.price),
          stock: sku.stock ?? 0,
          attributes: sku.attributes ?? {},
        })),
      )
    }
    const skus = await tx
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.productId, product.id))
    return { ...product, skus }
  })
}

export async function updateProduct(
  id: string,
  input: Static<typeof UpdateProductInputSchema>,
  client: DbClient,
): Promise<
  Result<
    typeof schema.products.$inferSelect & { skus: (typeof schema.productSkus.$inferSelect)[] },
    'PRODUCT_NOT_FOUND' | 'SKU_NOT_FOUND'
  >
> {
  return withTransaction(client, async (tx) => {
    const { skus, ...productFields } = input
    const [existing] = await tx.select().from(schema.products).where(eq(schema.products.id, id))
    if (!existing) return err('PRODUCT_NOT_FOUND')
    if (Object.keys(productFields).length > 0) {
      await tx.update(schema.products).set(productFields).where(eq(schema.products.id, id))
    }
    const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, id))

    if (skus && skus.length > 0) {
      const toUpdate = skus.filter((s) => s.id !== undefined)
      const toInsert = skus.filter((s) => s.id === undefined)

      if (toUpdate.length > 0) {
        const owned = await tx
          .select({ id: schema.productSkus.id })
          .from(schema.productSkus)
          .where(
            and(
              eq(schema.productSkus.productId, id),
              inArray(
                schema.productSkus.id,
                toUpdate.map((s) => s.id!),
              ),
            ),
          )
        const ownedIds = new Set(owned.map((row) => row.id))
        for (const sku of toUpdate) {
          // 不属于本商品的 sku id 显式报错, 不静默跳过
          if (!ownedIds.has(sku.id!)) return err('SKU_NOT_FOUND')
        }
        for (const sku of toUpdate) {
          await tx
            .update(schema.productSkus)
            .set({
              name: sku.name,
              skuCode: sku.skuCode,
              price: String(sku.price),
              stock: sku.stock ?? 0,
              attributes: sku.attributes ?? {},
            })
            .where(eq(schema.productSkus.id, sku.id!))
        }

        // 软删除未在提交列表中的现有活跃 SKU(结清 tech-debt #11)
        // 仅当明确提供了现有 SKU 时比对差异并软删; 若只传新 SKU 则为纯追加语义
        const updatedIds = new Set(toUpdate.map((s) => s.id!))
        const currentActive = await tx
          .select({ id: schema.productSkus.id })
          .from(schema.productSkus)
          .where(and(eq(schema.productSkus.productId, id), isNull(schema.productSkus.deletedAt)))
        const toDeleteIds = currentActive
          .map((row) => row.id)
          .filter((existingId) => !updatedIds.has(existingId))
        if (toDeleteIds.length > 0) {
          await tx
            .update(schema.productSkus)
            .set({ deletedAt: new Date() })
            .where(inArray(schema.productSkus.id, toDeleteIds))
        }
      }

      if (toInsert.length > 0) {
        await tx.insert(schema.productSkus).values(
          toInsert.map((sku) => ({
            productId: id,
            name: sku.name,
            skuCode: sku.skuCode,
            price: String(sku.price),
            stock: sku.stock ?? 0,
            attributes: sku.attributes ?? {},
          })),
        )
      }
    }

    const skusAfter = await tx
      .select()
      .from(schema.productSkus)
      .where(
        and(eq(schema.productSkus.productId, product.id), isNull(schema.productSkus.deletedAt)),
      )
    return ok({ ...product, skus: skusAfter })
  })
}

export async function removeProduct(id: string, client: DbClient) {
  return withTransaction(client, async (tx) => {
    const [product] = await tx.delete(schema.products).where(eq(schema.products.id, id)).returning()
    if (!product) return err('PRODUCT_NOT_FOUND')
    return ok()
  })
}

export interface LowStockSkuRow {
  skuId: string
  skuName: string
  productId: string
  productName: string
  stock: number
}

// 低库存预警: 未软删 SKU + 所属商品非归档, 库存 <= threshold(含 0)按库存升序
export async function listLowStockSkus(
  threshold: number,
  client: DbClient,
  limit = 20,
): Promise<LowStockSkuRow[]> {
  return client
    .select({
      skuId: schema.productSkus.id,
      skuName: schema.productSkus.name,
      productId: schema.productSkus.productId,
      productName: schema.products.name,
      stock: schema.productSkus.stock,
    })
    .from(schema.productSkus)
    .innerJoin(schema.products, eq(schema.productSkus.productId, schema.products.id))
    .where(
      and(
        isNull(schema.productSkus.deletedAt),
        lt(schema.productSkus.stock, threshold + 1),
        ne(schema.products.status, 'archived'),
      ),
    )
    .orderBy(schema.productSkus.stock)
    .limit(limit)
}

export async function listCategories(opts: { page: number; pageSize: number }, client: DbClient) {
  const { page, pageSize } = opts
  const offset = (page - 1) * pageSize
  const items = await client
    .select()
    .from(schema.categories)
    .orderBy(schema.categories.sortOrder)
    .limit(pageSize)
    .offset(offset)
  const [{ total }] = await client.select({ total: count() }).from(schema.categories)
  return { items, total: Number(total), page, pageSize }
}

export async function createCategory(
  input: Static<typeof CreateCategoryInputSchema>,
  client: DbClient,
) {
  const [cat] = await client.insert(schema.categories).values(input).returning()
  return cat
}

export async function updateCategory(
  id: string,
  input: Static<typeof UpdateCategoryInputSchema>,
  client: DbClient,
): Promise<
  Result<
    typeof schema.categories.$inferSelect,
    'CATEGORY_NOT_FOUND' | 'CATEGORY_PARENT_NOT_FOUND' | 'CATEGORY_CYCLE'
  >
> {
  return withTransaction(client, async (tx) => {
    const [cat] = await tx.select().from(schema.categories).where(eq(schema.categories.id, id))
    if (!cat) return err('CATEGORY_NOT_FOUND')

    if (input.parentId !== undefined) {
      const [parent] = await tx
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.id, input.parentId))
      if (!parent) return err('CATEGORY_PARENT_NOT_FOUND')
      // 父级不能是自己或自己的子孙; 沿 parentId 向上回溯遇到 id 即成环
      let current: string | null = input.parentId
      const visited = new Set<string>()
      while (current) {
        if (current === id || visited.has(current)) return err('CATEGORY_CYCLE')
        visited.add(current)
        const [row] = await tx
          .select()
          .from(schema.categories)
          .where(eq(schema.categories.id, current))
        current = row?.parentId ?? null
      }
    }

    const [updated] = await tx
      .update(schema.categories)
      .set(input)
      .where(eq(schema.categories.id, id))
      .returning()
    return ok(updated)
  })
}

export async function removeCategory(id: string, client: DbClient) {
  return withTransaction(client, async (tx) => {
    const [cat] = await tx.select().from(schema.categories).where(eq(schema.categories.id, id))
    if (!cat) return err('CATEGORY_NOT_FOUND')
    const [ref] = await tx
      .select({ count: count() })
      .from(schema.products)
      .where(eq(schema.products.categoryId, id))
    if (Number(ref.count) > 0) return err('CATEGORY_HAS_PRODUCTS')
    await tx.delete(schema.categories).where(eq(schema.categories.id, id))
    return ok()
  })
}
