import type { DomainError } from '@epinfresh/shared'
import { toHttpStatus } from '@epinfresh/shared'
import { Elysia, t } from 'elysia'
import { productModel } from './model'
import { ProductService } from './service'

function setError(set: { status?: number | string | undefined }, err: DomainError) {
  const { statusCode, body } = toHttpStatus(err)
  set.status = statusCode
  return body
}

export const productWWWPlugin = new Elysia({ name: 'product-www', prefix: '/api/v1' })
  .use(productModel)
  .get(
    '/products',
    async ({ query, set }) => {
      const r = await ProductService.list({
        page: Number(query.page) || 1,
        pageSize: Number(query.pageSize) || 20,
        categoryId: query.categoryId,
        status: 'published',
      })
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      query: 'ProductListQuery',
      detail: { tags: ['Products'] },
    },
  )
  .get(
    '/products/:id',
    async ({ params, set }) => {
      const r = await ProductService.getByIdPublic(params.id)
      if (r.isOk()) return r.value
      return setError(set, r.error)
    },
    {
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      detail: { tags: ['Products'] },
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
      detail: { tags: ['Categories'] },
    },
  )
