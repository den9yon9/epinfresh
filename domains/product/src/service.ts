import { type DbClient, schema } from '@epinfresh/database'
import { type Result, err, ok } from '@epinfresh/shared'
import type { Static } from '@sinclair/typebox'
import { and, count, eq, gte, sql } from 'drizzle-orm'
import type {
  AdminProductListQuerySchema,
  CreateCategoryInputSchema,
  CreateProductInputSchema,
  ProductListQuerySchema,
  UpdateProductInputSchema,
} from './model'

export async function listAllProducts(
  query: Static<typeof AdminProductListQuerySchema>,
  client: DbClient,
) {
  const { page, pageSize } = query
  const offset = (page - 1) * pageSize

  const filters: ReturnType<typeof eq>[] = []
  if (query.categoryId) filters.push(eq(schema.products.categoryId, query.categoryId))
  if (query.status) filters.push(eq(schema.products.status, query.status))
  const where = filters.length > 0 ? and(...filters) : undefined

  const items = await client.query.products.findMany({
    where,
    orderBy: (products, { asc }) => asc(products.createdAt),
    limit: pageSize,
    offset,
    with: { skus: true },
  })
  const [{ total }] = await client.select({ total: count() }).from(schema.products).where(where)
  return { items, total: Number(total), page, pageSize }
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
    with: { skus: true },
  })
  if (!product) return err('PRODUCT_NOT_FOUND')
  return ok(product)
}

export async function getProductByIdPublic(id: string, client: DbClient) {
  const product = await client.query.products.findFirst({
    where: and(eq(schema.products.id, id), eq(schema.products.status, 'published')),
    with: { skus: true },
  })
  if (!product) return err('PRODUCT_NOT_FOUND')
  return ok(product)
}

export async function reduceProductStock(
  skuId: string,
  quantity: number,
  client: DbClient,
): Promise<Result<void, 'SKU_NOT_FOUND' | 'INSUFFICIENT_STOCK'>> {
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
    return err('INSUFFICIENT_STOCK')
  }
  return ok()
}

export async function createProduct(
  input: Static<typeof CreateProductInputSchema>,
  client: DbClient,
) {
  return client.transaction(async (tx) => {
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
  return client.transaction(async (tx) => {
    const [product] = await tx
      .update(schema.products)
      .set(input)
      .where(eq(schema.products.id, id))
      .returning()
    if (!product) return err('PRODUCT_NOT_FOUND')
    const skus = await tx
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.productId, product.id))
    return ok({ ...product, skus })
  })
}

export async function removeProduct(id: string, client: DbClient) {
  return client.transaction(async (tx) => {
    const [product] = await tx.delete(schema.products).where(eq(schema.products.id, id)).returning()
    if (!product) return err('PRODUCT_NOT_FOUND')
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

export async function removeCategory(id: string, client: DbClient) {
  return client.transaction(async (tx) => {
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
