import { type DbClient, schema, withTransaction } from '@epinfresh/database'
import { err, ok, type Result } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { and, asc, count, eq, gte, ilike, inArray, type SQL, sql } from 'drizzle-orm'

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
      inArray(
        schema.productSkus.productId,
        products.map((p) => p.id),
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
  if (!product) return err({ code: 'PRODUCT_NOT_FOUND' } as const)
  const [withSkus] = await attachSkus([product], client)
  return ok(withSkus)
}

export async function getProductByIdPublic(id: string, client: DbClient) {
  const product = await client.query.products.findFirst({
    where: and(eq(schema.products.id, id), eq(schema.products.status, 'published')),
  })
  if (!product) return err({ code: 'PRODUCT_NOT_FOUND' } as const)
  const [withSkus] = await attachSkus([product], client)
  return ok(withSkus)
}

export async function getSkusByIds(skuIds: string[], client: DbClient) {
  if (skuIds.length === 0) return []
  return client.query.productSkus.findMany({
    where: inArray(schema.productSkus.id, skuIds),
    with: { product: true },
  })
}

export async function reduceProductStock(
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<void, { code: 'SKU_NOT_FOUND' } | { code: 'INSUFFICIENT_STOCK' }>> {
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
    if (!sku) return err({ code: 'SKU_NOT_FOUND' } as const)
    return err({ code: 'INSUFFICIENT_STOCK' } as const)
  }
  return ok()
}

export async function restoreProductStock(
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<void, { code: 'SKU_NOT_FOUND' }>> {
  const [updated] = await client
    .update(schema.productSkus)
    .set({
      stock: sql`${schema.productSkus.stock} + ${quantity}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.productSkus.id, skuId))
    .returning()
  if (!updated) return err({ code: 'SKU_NOT_FOUND' } as const)
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
) {
  return withTransaction(client, async (tx) => {
    const { skus, ...productFields } = input
    const [existing] = await tx.select().from(schema.products).where(eq(schema.products.id, id))
    if (!existing) return err({ code: 'PRODUCT_NOT_FOUND' } as const)
    if (Object.keys(productFields).length > 0) {
      await tx.update(schema.products).set(productFields).where(eq(schema.products.id, id))
    }
    const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, id))

    if (skus && skus.length > 0) {
      for (const sku of skus) {
        const values = {
          name: sku.name,
          skuCode: sku.skuCode,
          price: String(sku.price),
          stock: sku.stock ?? 0,
          attributes: sku.attributes ?? {},
        }
        if (sku.id) {
          // 仅更新属于该商品的行; 跨商品 id 静默跳过
          await tx
            .update(schema.productSkus)
            .set(values)
            .where(and(eq(schema.productSkus.id, sku.id), eq(schema.productSkus.productId, id)))
        } else {
          await tx.insert(schema.productSkus).values({ productId: id, ...values })
        }
      }
    }

    const skusAfter = await tx
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.productId, product.id))
    return ok({ ...product, skus: skusAfter })
  })
}

export async function removeProduct(id: string, client: DbClient) {
  return withTransaction(client, async (tx) => {
    const [product] = await tx.delete(schema.products).where(eq(schema.products.id, id)).returning()
    if (!product) return err({ code: 'PRODUCT_NOT_FOUND' } as const)
    return ok()
  })
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
    | { code: 'CATEGORY_NOT_FOUND' }
    | { code: 'CATEGORY_PARENT_NOT_FOUND' }
    | { code: 'CATEGORY_CYCLE' }
  >
> {
  return withTransaction(client, async (tx) => {
    const [cat] = await tx.select().from(schema.categories).where(eq(schema.categories.id, id))
    if (!cat) return err({ code: 'CATEGORY_NOT_FOUND' } as const)

    if (input.parentId !== undefined) {
      const [parent] = await tx
        .select()
        .from(schema.categories)
        .where(eq(schema.categories.id, input.parentId))
      if (!parent) return err({ code: 'CATEGORY_PARENT_NOT_FOUND' } as const)
      // 父级不能是自己或自己的子孙; 沿 parentId 向上回溯遇到 id 即成环
      let current: string | null = input.parentId
      const visited = new Set<string>()
      while (current) {
        if (current === id || visited.has(current)) return err({ code: 'CATEGORY_CYCLE' } as const)
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
    if (!cat) return err({ code: 'CATEGORY_NOT_FOUND' } as const)
    const [ref] = await tx
      .select({ count: count() })
      .from(schema.products)
      .where(eq(schema.products.categoryId, id))
    if (Number(ref.count) > 0) return err({ code: 'CATEGORY_HAS_PRODUCTS' } as const)
    await tx.delete(schema.categories).where(eq(schema.categories.id, id))
    return ok()
  })
}
