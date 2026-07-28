export { productModel } from './model'
export { productStorefrontPlugin } from './storefront'
export { productAdminPlugin } from './admin'
export {
  listAllProducts,
  listPublishedProducts,
  getProductById,
  getProductByIdPublic,
  reduceProductStock,
  createProduct,
  updateProduct,
  removeProduct,
  listCategories,
  createCategory,
  removeCategory,
} from './service'
export type { ProductModel } from './model'
