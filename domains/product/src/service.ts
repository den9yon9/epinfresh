import { db, schema } from '@epinfresh/database'
import type { ProductStatus } from '@epinfresh/shared'
import { type Result, err, ok } from '@epinfresh/shared'
import { and, count, eq } from 'drizzle-orm'

export type ProductDTO = {
  id: string
  name: string
  slug: string
  description: string | null
  categoryId: string | null
  images: string[]
  status: ProductStatus
  createdAt: Date
  updatedAt: Date
  skus: Array<{
    id: string
    productId: string
    name: string
    skuCode: string
    price: string
    stock: number
    attributes: Record<string, string>
    createdAt: Date
    updatedAt: Date
  }>
}

export type CategoryDTO = {
  id: string
  name: string
  slug: string
  parentId: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export class ProductService {
  static async list(query: {
    page?: number
    pageSize?: number
    categoryId?: string
    status?: ProductStatus
  }) {
    const page = Math.max(query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100)
    const offset = (page - 1) * pageSize

    const filters: ReturnType<typeof eq>[] = []
    if (query.categoryId) filters.push(eq(schema.products.categoryId, query.categoryId))
    if (query.status) filters.push(eq(schema.products.status, query.status))
    const where = filters.length > 0 ? and(...filters) : undefined

    const items = await db
      .select()
      .from(schema.products)
      .where(where)
      .orderBy(schema.products.createdAt)
      .limit(pageSize)
      .offset(offset)
    const [{ total }] = await db.select({ total: count() }).from(schema.products).where(where)
    if (items.length === 0)
      return { items: [] as ProductDTO[], total: Number(total), page, pageSize }

    const skus = await db
      .select()
      .from(schema.productSkus)
      .where(and(...items.map((p) => eq(schema.productSkus.productId, p.id))))
    const skuMap = new Map<string, ProductDTO['skus']>()
    for (const sku of skus) {
      const arr = skuMap.get(sku.productId) ?? []
      arr.push(sku as ProductDTO['skus'][number])
      skuMap.set(sku.productId, arr)
    }
    return {
      items: items.map((p) => ({ ...p, skus: skuMap.get(p.id) ?? [] })) as ProductDTO[],
      total: Number(total),
      page,
      pageSize,
    }
  }

  static async getById(id: string): Promise<Result<ProductDTO, 'PRODUCT_NOT_FOUND'>> {
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id))
    if (!product) return err('PRODUCT_NOT_FOUND')
    const skus = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.productId, id))
    return ok({ ...product, skus } as ProductDTO)
  }

  static async getByIdPublic(id: string): Promise<Result<ProductDTO, 'PRODUCT_NOT_FOUND'>> {
    const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id))
    if (!product || product.status !== 'published') return err('PRODUCT_NOT_FOUND')
    const skus = await db
      .select()
      .from(schema.productSkus)
      .where(eq(schema.productSkus.productId, id))
    return ok({ ...product, skus } as ProductDTO)
  }

  static async create(input: {
    name: string
    slug: string
    description?: string
    categoryId?: string
    images?: string[]
    status?: ProductStatus
    skus?: Array<{
      name: string
      skuCode: string
      price: number
      stock?: number
      attributes?: Record<string, string>
    }>
  }): Promise<ProductDTO> {
    return db.transaction(async (tx) => {
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
      return { ...product, skus } as ProductDTO
    })
  }

  static async update(
    id: string,
    input: {
      name?: string
      slug?: string
      description?: string
      categoryId?: string
      images?: string[]
      status?: ProductStatus
    },
  ): Promise<Result<ProductDTO, 'PRODUCT_NOT_FOUND'>> {
    return db.transaction(async (tx): Promise<Result<ProductDTO, 'PRODUCT_NOT_FOUND'>> => {
      const setPayload: Record<string, unknown> = { updatedAt: new Date() }
      if (input.name !== undefined) setPayload.name = input.name
      if (input.slug !== undefined) setPayload.slug = input.slug
      if (input.description !== undefined) setPayload.description = input.description
      if (input.categoryId !== undefined) setPayload.categoryId = input.categoryId
      if (input.images !== undefined) setPayload.images = input.images
      if (input.status !== undefined) setPayload.status = input.status
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
      return ok({ ...product, skus } as ProductDTO)
    })
  }

  static async remove(id: string): Promise<Result<void, 'PRODUCT_NOT_FOUND'>> {
    return db.transaction(async (tx): Promise<Result<void, 'PRODUCT_NOT_FOUND'>> => {
      const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, id))
      if (!product) return err('PRODUCT_NOT_FOUND')
      await tx.delete(schema.productSkus).where(eq(schema.productSkus.productId, id))
      await tx.delete(schema.products).where(eq(schema.products.id, id))
      return ok(undefined)
    })
  }

  static async listCategories(): Promise<CategoryDTO[]> {
    return db.select().from(schema.categories).orderBy(schema.categories.sortOrder)
  }

  static async createCategory(input: {
    name: string
    slug: string
    parentId?: string
    sortOrder?: number
  }): Promise<CategoryDTO> {
    const [cat] = await db
      .insert(schema.categories)
      .values({
        name: input.name,
        slug: input.slug,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? 0,
      })
      .returning()
    return cat as CategoryDTO
  }

  static async removeCategory(
    id: string,
  ): Promise<Result<void, 'CATEGORY_NOT_FOUND' | 'CATEGORY_HAS_PRODUCTS'>> {
    return db.transaction(
      async (tx): Promise<Result<void, 'CATEGORY_NOT_FOUND' | 'CATEGORY_HAS_PRODUCTS'>> => {
        const [cat] = await tx.select().from(schema.categories).where(eq(schema.categories.id, id))
        if (!cat) return err('CATEGORY_NOT_FOUND')
        const [ref] = await tx
          .select({ count: count() })
          .from(schema.products)
          .where(eq(schema.products.categoryId, id))
        if (Number(ref.count) > 0) return err('CATEGORY_HAS_PRODUCTS')
        await tx.delete(schema.categories).where(eq(schema.categories.id, id))
        return ok(undefined)
      },
    )
  }
}
