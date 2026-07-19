import { db, schema } from '@epinfresh/database'
import { and, count, eq } from 'drizzle-orm'
import type { ProductModel } from './model'

export abstract class ProductService {
  static async list(query: {
    page?: number
    pageSize?: number
    categoryId?: string
    status?: string
  }) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const offset = (page - 1) * pageSize

    const filters: ReturnType<typeof eq>[] = []
    if (query.categoryId) filters.push(eq(schema.products.categoryId, query.categoryId))
    if (query.status) filters.push(eq(schema.products.status, query.status))

    const where = filters.length > 0 ? and(...filters) : undefined

    const items = await db
      .select()
      .from(schema.products)
      .where(where)
      .limit(pageSize)
      .offset(offset)
    const [{ total }] = await db.select({ total: count() }).from(schema.products).where(where)

    return { items, total: Number(total), page, pageSize }
  }

  static async getById(id: string) {
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id))
    if (!product) return null

    const skus = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.productId, id))

    return { ...product, skus }
  }

  static async create(input: ProductModel['CreateProductInput']) {
    const [product] = await db
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

    if (input.skus?.length) {
      await db.insert(schema.productSkus).values(
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

    return ProductService.getById(product.id)
  }

  static async update(id: string, input: ProductModel['UpdateProductInput']) {
    const [product] = await db
      .update(schema.products)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.products.id, id))
      .returning()

    if (!product) return null
    return ProductService.getById(product.id)
  }

  static async remove(id: string) {
    await db.delete(schema.productSkus).where(eq(schema.productSkus.productId, id))
    await db.delete(schema.products).where(eq(schema.products.id, id))
  }

  static async listCategories() {
    return db.select().from(schema.categories).orderBy(schema.categories.sortOrder)
  }

  static async createCategory(input: ProductModel['CreateCategoryInput']) {
    const [cat] = await db
      .insert(schema.categories)
      .values({
        name: input.name,
        slug: input.slug,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
    return cat
  }

  static async removeCategory(id: string) {
    await db.delete(schema.categories).where(eq(schema.categories.id, id))
  }
}
