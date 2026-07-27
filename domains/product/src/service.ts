import { type DbClient, db, schema } from '@epinfresh/database'
import { type Result, err, ok } from '@epinfresh/shared'
import { and, count, eq, gte, sql } from 'drizzle-orm'
import type { ProductModel } from './model'

export const createProductService = (client: DbClient = db) => {
  const service = {
    async list(query: ProductModel['AdminProductListQuery']) {
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
    },

    async getById(id: string) {
      const product = await client.query.products.findFirst({
        where: eq(schema.products.id, id),
        with: { skus: true },
      })
      if (!product) return err('PRODUCT_NOT_FOUND')
      return ok(product)
    },

    async getByIdPublic(id: string) {
      const product = await client.query.products.findFirst({
        where: and(eq(schema.products.id, id), eq(schema.products.status, 'published')),
        with: { skus: true },
      })
      if (!product) return err('PRODUCT_NOT_FOUND')
      return ok(product)
    },

    async reduceStock(
      skuId: string,
      quantity: number,
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
      return ok(undefined)
    },

    async create(input: ProductModel['CreateProductInput']) {
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
    },

    async update(id: string, input: ProductModel['UpdateProductInput']) {
      const setPayload: Record<string, unknown> = {}
      if (input.name !== undefined) setPayload.name = input.name
      if (input.slug !== undefined) setPayload.slug = input.slug
      if (input.description !== undefined) setPayload.description = input.description
      if (input.categoryId !== undefined) setPayload.categoryId = input.categoryId
      if (input.images !== undefined) setPayload.images = input.images
      if (input.status !== undefined) setPayload.status = input.status
      if (Object.keys(setPayload).length === 0) {
        return service.getById(id)
      }
      return client.transaction(async (tx) => {
        const [product] = await tx
          .update(schema.products)
          .set(setPayload)
          .where(eq(schema.products.id, id))
          .returning()
        if (!product) return err('PRODUCT_NOT_FOUND')
        const skus = await tx
          .select()
          .from(schema.productSkus)
          .where(eq(schema.productSkus.productId, product.id))
        return ok({ ...product, skus })
      })
    },

    async remove(id: string) {
      return client.transaction(async (tx) => {
        const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, id))
        if (!product) return err('PRODUCT_NOT_FOUND')
        await tx.delete(schema.products).where(eq(schema.products.id, id))
        return ok(undefined)
      })
    },

    async listCategories(opts: { page: number; pageSize: number }) {
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
    },

    async createCategory(input: ProductModel['CreateCategoryInput']) {
      const [cat] = await client.insert(schema.categories).values(input).returning()
      return cat
    },

    async removeCategory(id: string) {
      return client.transaction(async (tx) => {
        const [cat] = await tx.select().from(schema.categories).where(eq(schema.categories.id, id))
        if (!cat) return err('CATEGORY_NOT_FOUND')
        const [ref] = await tx
          .select({ count: count() })
          .from(schema.products)
          .where(eq(schema.products.categoryId, id))
        if (Number(ref.count) > 0) return err('CATEGORY_HAS_PRODUCTS')
        await tx.delete(schema.categories).where(eq(schema.categories.id, id))
        return ok(undefined)
      })
    },
  }

  return service
}

export const productService = createProductService(db)
export type ProductService = ReturnType<typeof createProductService>
