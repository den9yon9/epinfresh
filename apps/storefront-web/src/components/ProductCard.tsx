import { Link } from '@tanstack/react-router'

interface ProductCardProps {
  product: {
    id: string
    name: string
    images: string[]
    skus: Array<{ price: string }>
  }
}

export function ProductCard({ product }: ProductCardProps) {
  const minPrice = Math.min(...product.skus.map((s) => Number(s.price)))
  const image = product.images[0]
  return (
    <Link
      to="/products/$id"
      params={{ id: product.id }}
      className="block overflow-hidden rounded-xl bg-white shadow-sm"
    >
      {image ? (
        <img
          src={image}
          alt={product.name}
          className="aspect-square w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-brand-50 text-gray-300">
          无图
        </div>
      )}
      <div className="p-2">
        <p className="truncate text-sm text-gray-800">{product.name}</p>
        <p className="mt-1 text-brand-600">
          <span className="text-lg font-bold">¥{minPrice.toFixed(2)}</span>
          {product.skus.length > 1 && <span className="text-xs text-gray-400"> 起</span>}
        </p>
      </div>
    </Link>
  )
}
