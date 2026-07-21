import type { DomainError } from '@epinfresh/shared'
import { type ProductStatus, toHttpStatus } from '@epinfresh/shared'
import { Elysia, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

function setError(set: { status?: number | string | undefined }, err: DomainError) {
  const { statusCode, body } = toHttpStatus(err)
  set.status = statusCode
  return body
}

export const productAdminPlugin = new Elysia({ name: 'product-admin', prefix: '/api/v1/admin' })
  .use(productModel)
  .get(
    '/products',
    async ({ query, set }) => {
      const r = await ProductService.list({
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 20,
        categoryId: query.categoryId,
        status: query.status as ProductStatus | undefined,
      })
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      query: 'AdminProductListQuery',
      detail: { tags: ['Admin/Products'] },
    },
  )
  .get(
    '/products/:id',
    async ({ params, set }) => {
      const r = await ProductService.getById(params.id)
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Products'] },
    },
  )
  .post(
    '/products',
    async ({ body, set }) => {
      const r = await ProductService.create(body)
      if (r.isOk()) {
        set.status = 201
        return r.value
      }
      return setError(set, r.error)
    },
    {
      body: 'CreateProductInput',
      detail: { tags: ['Admin/Products'] },
    },
  )
  .put(
    '/products/:id',
    async ({ params, body, set }) => {
      const r = await ProductService.update(params.id, body)
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      body: 'UpdateProductInput',
      detail: { tags: ['Admin/Products'] },
    },
  )
  .delete(
    '/products/:id',
    async ({ params, set }) => {
      const r = await ProductService.remove(params.id)
      if (r.isOk()) {
        set.status = 204
        return null
      }
      return setError(set, r.error)
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Products'] },
    },
  )
  .get(
    '/categories',
    async ({ set }) => {
      const r = await ProductService.listCategories()
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      detail: { tags: ['Admin/Categories'] },
    },
  )
  .post(
    '/categories',
    async ({ body, set }) => {
      const r = await ProductService.createCategory(body)
      if (r.isOk()) {
        set.status = 201
        return r.value
      }
      return setError(set, r.error)
    },
    {
      body: 'CreateCategoryInput',
      detail: { tags: ['Admin/Categories'] },
    },
  )
  .delete(
    '/categories/:id',
    async ({ params, set }) => {
      const r = await ProductService.removeCategory(params.id)
      if (r.isOk()) {
        set.status = 204
        return null
      }
      return setError(set, r.error)
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Admin/Categories'] },
    },
  )
