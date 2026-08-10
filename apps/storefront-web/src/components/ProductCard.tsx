import { Link } from '@tanstack/react-router'

import type { Product } from '../libs/api/types'

interface ProductCardProps {
  product: Product
}

export function ProductCard({ product }: ProductCardProps) {
  const minPrice = Math.min(...product.skus.map((s) => Number(s.price)))
  const image = product.images[0]
  const soldOut = product.skus.every((s) => s.stock <= 0)
  return (
    <Link
      to="/products/$id"
      params={{ id: product.id }}
      className="block overflow-hidden rounded-xl bg-white shadow-sm"
    >
      <div className="relative">
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
        {soldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <span className="rounded-full bg-gray-800/80 px-3 py-1 text-sm text-white">已售罄</span>
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="truncate text-sm text-gray-800">{product.name}</p>
        <p className={`mt-1 ${soldOut ? 'text-gray-400' : 'text-brand-600'}`}>
          <span className="text-lg font-bold">¥{minPrice.toFixed(2)}</span>
          {product.skus.length > 1 && <span className="text-xs text-gray-400"> 起</span>}
        </p>
      </div>
    </Link>
  )
}
