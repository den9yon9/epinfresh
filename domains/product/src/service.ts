import { db, schema } from '@epinfresh/database'
import {
  type DomainError,
  type ProductStatus,
  ResultAsync,
  conflict,
  internal,
  notFound,
} from '@epinfresh/shared'
import { and, count, eq } from 'drizzle-orm'

interface SkuInput {
  name: string
  skuCode: string
  price: number
  stock?: number
  attributes?: Record<string, string>
}

interface CreateProductInput {
  name: string
  slug: string
  description?: string
  categoryId?: string
  images?: string[]
  status?: ProductStatus
  skus?: SkuInput[]
}

interface UpdateProductInput {
  name?: string
  slug?: string
  description?: string
  categoryId?: string
  images?: string[]
  status?: ProductStatus
}

interface ListQueryBase {
  page?: number
  pageSize?: number
  categoryId?: string
  status?: ProductStatus
}

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

class NotFoundErr extends Error {
  constructor(
    readonly entity: string,
    readonly id?: string,
  ) {
    super(`${entity} not found`)
  }
}

class ConflictErr extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function unwrapPgCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null
  const e = err as { code?: unknown }
  return typeof e.code === 'string' ? e.code : null
}

const safeUnwrap =
  <T>(entity: string, id?: string) =>
  (err: unknown) =>
    err instanceof NotFoundErr
      ? notFound(entity, id)
      : err instanceof ConflictErr
        ? conflict(err.code as never, err.message)
        : internal((err as Error)?.message ?? 'unknown database error', err)

export class ProductService {
  static list(
    query: ListQueryBase = {},
  ): ResultAsync<
    { items: ProductDTO[]; total: number; page: number; pageSize: number },
    DomainError
  > {
    const page = Math.max(query.page ?? 1, 1)
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100)
    const offset = (page - 1) * pageSize

    const filters: ReturnType<typeof eq>[] = []
    if (query.categoryId) filters.push(eq(schema.products.categoryId, query.categoryId))
    if (query.status) filters.push(eq(schema.products.status, query.status))
    const where = filters.length > 0 ? and(...filters) : undefined

    return ResultAsync.fromPromise(
      (async () => {
        const items = await db
          .select()
          .from(schema.products)
          .where(where)
          .orderBy(schema.products.createdAt)
          .limit(pageSize)
          .offset(offset)
        const [{ total }] = await db.select({ total: count() }).from(schema.products).where(where)
        if (items.length === 0) {
          return {
            items: [] as ProductDTO[],
            total: Number(total),
            page,
            pageSize,
          }
        }
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
      })(),
      safeUnwrap('Product listing'),
    )
  }

  static getById(id: string): ResultAsync<ProductDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id))
        if (!product) throw new NotFoundErr('Product', id)
        const skus = await db
          .select()
          .from(schema.productSkus)
          .where(eq(schema.productSkus.productId, id))
        return { ...product, skus } as ProductDTO
      })(),
      safeUnwrap('Product', id),
    )
  }

  static getByIdPublic(id: string): ResultAsync<ProductDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        const [product] = await db.select().from(schema.products).where(eq(schema.products.id, id))
        if (!product || product.status !== 'published') throw new NotFoundErr('Product', id)
        const skus = await db
          .select()
          .from(schema.productSkus)
          .where(eq(schema.productSkus.productId, id))
        return { ...product, skus } as ProductDTO
      })(),
      safeUnwrap('Product', id),
    )
  }

  static create(input: CreateProductInput): ResultAsync<ProductDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        return db.transaction(async (tx) => {
          try {
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
          } catch (rawErr) {
            const code = unwrapPgCode(rawErr)
            if (code === '23505') {
              const msg = rawErr instanceof Error ? rawErr.message : 'duplicate'
              if (msg.includes('products_slug'))
                throw new ConflictErr('DUPLICATE_SLUG', 'Slug already exists')
              if (msg.includes('product_skus_sku_code'))
                throw new ConflictErr('DUPLICATE_SKU_CODE', 'SKU code already exists')
              throw new ConflictErr('DUPLICATE_SLUG', 'Slug or SKU code already exists')
            }
            throw rawErr
          }
        })
      })(),
      safeUnwrap('Product'),
    )
  }

  static update(id: string, input: UpdateProductInput): ResultAsync<ProductDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        return db.transaction(async (tx) => {
          const setPayload: Record<string, unknown> = { updatedAt: new Date() }
          if (input.name !== undefined) setPayload.name = input.name
          if (input.slug !== undefined) setPayload.slug = input.slug
          if (input.description !== undefined) setPayload.description = input.description
          if (input.categoryId !== undefined) setPayload.categoryId = input.categoryId
          if (input.images !== undefined) setPayload.images = input.images
          if (input.status !== undefined) setPayload.status = input.status
          try {
            const [product] = await tx
              .update(schema.products)
              .set(setPayload)
              .where(eq(schema.products.id, id))
              .returning()
            if (!product) throw new NotFoundErr('Product', id)
            const skus = await tx
              .select()
              .from(schema.productSkus)
              .where(eq(schema.productSkus.productId, product.id))
            return { ...product, skus } as ProductDTO
          } catch (rawErr) {
            const code = unwrapPgCode(rawErr)
            if (code === '23505') throw new ConflictErr('DUPLICATE_SLUG', 'Slug already exists')
            throw rawErr
          }
        })
      })(),
      safeUnwrap('Product', id),
    )
  }

  static remove(id: string): ResultAsync<true, DomainError> {
    return ResultAsync.fromPromise(
      db.transaction(async (tx): Promise<true> => {
        const [product] = await tx.select().from(schema.products).where(eq(schema.products.id, id))
        if (!product) throw new NotFoundErr('Product', id)
        await tx.delete(schema.productSkus).where(eq(schema.productSkus.productId, id))
        await tx.delete(schema.products).where(eq(schema.products.id, id))
        return true
      }),
      safeUnwrap('Product', id),
    )
  }

  static listCategories(): ResultAsync<CategoryDTO[], DomainError> {
    return ResultAsync.fromPromise(
      db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
      safeUnwrap('Category'),
    )
  }

  static createCategory(input: {
    name: string
    slug: string
    parentId?: string
    sortOrder?: number
  }): ResultAsync<CategoryDTO, DomainError> {
    return ResultAsync.fromPromise(
      (async () => {
        try {
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
        } catch (rawErr) {
          const code = unwrapPgCode(rawErr)
          if (code === '23505')
            throw new ConflictErr('DUPLICATE_SLUG', 'Category slug already exists')
          throw rawErr
        }
      })(),
      safeUnwrap('Category'),
    )
  }

  static removeCategory(id: string): ResultAsync<true, DomainError> {
    return ResultAsync.fromPromise(
      db.transaction(async (tx): Promise<true> => {
        const [cat] = await tx.select().from(schema.categories).where(eq(schema.categories.id, id))
        if (!cat) throw new NotFoundErr('Category', id)
        const [ref] = await tx
          .select({ count: count() })
          .from(schema.products)
          .where(eq(schema.products.categoryId, id))
        if (Number(ref.count) > 0) {
          throw new ConflictErr(
            'CATEGORY_HAS_PRODUCTS',
            'Category still has products; cannot delete',
          )
        }
        await tx.delete(schema.categories).where(eq(schema.categories.id, id))
        return true
      }),
      safeUnwrap('Category', id),
    )
  }
}

export type { ProductStatus }
