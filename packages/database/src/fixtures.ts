import { createLogger, parseEnv } from '@epinfresh/shared'
import { Type } from '@sinclair/typebox'
import { count, eq } from 'drizzle-orm'

import { closeDb, createDb, schema } from './index'

const env = parseEnv(
  Type.Object({
    DATABASE_URL: Type.String({ format: 'uri' }),
    LOG_LEVEL: Type.Union(
      [
        Type.Literal('debug'),
        Type.Literal('info'),
        Type.Literal('warn'),
        Type.Literal('error'),
        Type.Literal('silent'),
      ],
      { default: 'info' },
    ),
  }),
)

interface SkuFixture {
  name: string
  skuCode: string
  price: number
  stock: number
  attributes: Record<string, string>
}

interface ProductFixture {
  name: string
  slug: string
  description: string
  skus: SkuFixture[]
}

interface CategoryFixture {
  name: string
  slug: string
  sortOrder: number
  products: ProductFixture[]
}

const FIXTURES: CategoryFixture[] = [
  {
    name: '蔬菜',
    slug: 'vegetables',
    sortOrder: 1,
    products: [
      {
        name: '有机番茄',
        slug: 'organic-tomato',
        description: '沙瓤多汁，自然成熟，适合生食与炖煮',
        skus: [
          {
            name: '有机番茄 500g',
            skuCode: 'veg-tomato-500g',
            price: 6.8,
            stock: 120,
            attributes: { 规格: '500g' },
          },
          {
            name: '有机番茄 1kg',
            skuCode: 'veg-tomato-1kg',
            price: 12.5,
            stock: 80,
            attributes: { 规格: '1kg' },
          },
        ],
      },
      {
        name: '西兰花',
        slug: 'broccoli',
        description: '产地直采，花球紧实，富含维生素 C',
        skus: [
          {
            name: '西兰花 1颗（约400g）',
            skuCode: 'veg-broccoli-400g',
            price: 8.9,
            stock: 100,
            attributes: { 规格: '约400g' },
          },
        ],
      },
      {
        name: '土豆',
        slug: 'potatoes',
        description: '黄心土豆，口感粉糯，炖炒皆宜',
        skus: [
          {
            name: '土豆 1kg',
            skuCode: 'veg-potato-1kg',
            price: 4.5,
            stock: 200,
            attributes: { 规格: '1kg' },
          },
          {
            name: '土豆 2.5kg',
            skuCode: 'veg-potato-2p5kg',
            price: 9.9,
            stock: 150,
            attributes: { 规格: '2.5kg' },
          },
        ],
      },
      {
        name: '上海青',
        slug: 'shanghai-green',
        description: '鲜嫩翠绿，当日采摘，清炒首选',
        skus: [
          {
            name: '上海青 300g',
            skuCode: 'veg-shanghai-300g',
            price: 3.2,
            stock: 180,
            attributes: { 规格: '300g' },
          },
        ],
      },
    ],
  },
  {
    name: '水果',
    slug: 'fruits',
    sortOrder: 2,
    products: [
      {
        name: '红富士苹果',
        slug: 'red-fuji-apple',
        description: '烟台红富士，脆甜多汁，果香浓郁',
        skus: [
          {
            name: '红富士苹果 1kg',
            skuCode: 'fruit-fuji-1kg',
            price: 12.8,
            stock: 150,
            attributes: { 规格: '1kg' },
          },
          {
            name: '红富士苹果 2.5kg',
            skuCode: 'fruit-fuji-2p5kg',
            price: 29.9,
            stock: 90,
            attributes: { 规格: '2.5kg' },
          },
        ],
      },
      {
        name: '香蕉',
        slug: 'banana',
        description: '菲律宾进口，软糯香甜，催熟可食',
        skus: [
          {
            name: '香蕉 1kg',
            skuCode: 'fruit-banana-1kg',
            price: 6.5,
            stock: 160,
            attributes: { 规格: '1kg' },
          },
        ],
      },
      {
        name: '阳光玫瑰葡萄',
        slug: 'sunshine-rose-grape',
        description: '粒粒饱满，自带玫瑰清香，无籽脆甜',
        skus: [
          {
            name: '阳光玫瑰葡萄 500g',
            skuCode: 'fruit-grape-500g',
            price: 25.8,
            stock: 60,
            attributes: { 规格: '500g' },
          },
        ],
      },
      {
        name: '赣南脐橙',
        slug: 'gannan-navel-orange',
        description: '赣南产地直发，果肉化渣，酸甜平衡',
        skus: [
          {
            name: '赣南脐橙 2.5kg',
            skuCode: 'fruit-orange-2p5kg',
            price: 19.9,
            stock: 110,
            attributes: { 规格: '2.5kg' },
          },
        ],
      },
    ],
  },
  {
    name: '肉禽蛋',
    slug: 'meat-eggs',
    sortOrder: 3,
    products: [
      {
        name: '土鸡蛋',
        slug: 'free-range-eggs',
        description: '散养土鸡产蛋，蛋黄橙黄，营养丰富',
        skus: [
          {
            name: '土鸡蛋 10枚',
            skuCode: 'meat-eggs-10',
            price: 15.9,
            stock: 200,
            attributes: { 规格: '10枚' },
          },
          {
            name: '土鸡蛋 20枚',
            skuCode: 'meat-eggs-20',
            price: 29.8,
            stock: 120,
            attributes: { 规格: '20枚' },
          },
        ],
      },
      {
        name: '鸡胸肉',
        slug: 'chicken-breast',
        description: '去皮去骨，低脂高蛋白，健身餐常备',
        skus: [
          {
            name: '鸡胸肉 500g',
            skuCode: 'meat-chicken-500g',
            price: 11.5,
            stock: 140,
            attributes: { 规格: '500g' },
          },
        ],
      },
      {
        name: '五花肉',
        slug: 'pork-belly',
        description: '肥瘦相间，红烧爆炒皆宜，当日分割',
        skus: [
          {
            name: '五花肉 500g',
            skuCode: 'meat-belly-500g',
            price: 22.8,
            stock: 100,
            attributes: { 规格: '500g' },
          },
        ],
      },
      {
        name: '牛腩',
        slug: 'beef-brisket',
        description: '进口草饲牛腩，筋肉相间，久炖软烂',
        skus: [
          {
            name: '牛腩 500g',
            skuCode: 'meat-brisket-500g',
            price: 39.9,
            stock: 70,
            attributes: { 规格: '500g' },
          },
        ],
      },
    ],
  },
  {
    name: '海鲜水产',
    slug: 'seafood',
    sortOrder: 4,
    products: [
      {
        name: '活基围虾',
        slug: 'live-shrimp',
        description: '鲜活捕捞，弹嫩鲜甜，白灼最佳',
        skus: [
          {
            name: '活基围虾 500g',
            skuCode: 'sea-shrimp-500g',
            price: 42.8,
            stock: 50,
            attributes: { 规格: '500g' },
          },
        ],
      },
      {
        name: '三文鱼刺身',
        slug: 'salmon-sashimi',
        description: '挪威冰鲜三文鱼，刺身级，冷链到家',
        skus: [
          {
            name: '三文鱼刺身 200g',
            skuCode: 'sea-salmon-200g',
            price: 35.8,
            stock: 40,
            attributes: { 规格: '200g' },
          },
        ],
      },
      {
        name: '带鱼段',
        slug: 'hairtail',
        description: '东海带鱼，肉质细嫩，油炸香酥',
        skus: [
          {
            name: '带鱼段 500g',
            skuCode: 'sea-hairtail-500g',
            price: 18.5,
            stock: 90,
            attributes: { 规格: '500g' },
          },
        ],
      },
      {
        name: '生蚝',
        slug: 'oyster',
        description: '乳山生蚝，肥美多汁，蒜蓉清蒸皆宜',
        skus: [
          {
            name: '生蚝 6只',
            skuCode: 'sea-oyster-6',
            price: 24.9,
            stock: 80,
            attributes: { 规格: '6只' },
          },
        ],
      },
    ],
  },
]

async function upsertCategory(db: ReturnType<typeof createDb>, c: CategoryFixture) {
  const [row] = await db
    .insert(schema.categories)
    .values({ name: c.name, slug: c.slug, sortOrder: c.sortOrder })
    .onConflictDoNothing()
    .returning()
  if (row) return row.id
  const [existing] = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(eq(schema.categories.slug, c.slug))
  return existing.id
}

async function upsertProduct(
  db: ReturnType<typeof createDb>,
  p: ProductFixture,
  categoryId: string,
) {
  const [row] = await db
    .insert(schema.products)
    .values({
      name: p.name,
      slug: p.slug,
      description: p.description,
      categoryId,
      images: [`https://picsum.photos/seed/${p.slug}/400/400`],
      status: 'published',
    })
    .onConflictDoNothing()
    .returning()
  const productId =
    row?.id ??
    (
      await db
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.slug, p.slug))
    )[0].id
  for (const sku of p.skus) {
    await db
      .insert(schema.productSkus)
      .values({
        productId,
        name: sku.name,
        skuCode: sku.skuCode,
        price: String(sku.price),
        stock: sku.stock,
        attributes: sku.attributes,
      })
      .onConflictDoNothing()
  }
  return productId
}

async function resetFixtures(db: ReturnType<typeof createDb>) {
  // ponytail: orderItems 对 sku 是 restrict, 有订单数据时删除会被外键拒绝, 预检报错而非级联
  const [ref] = await db.select({ n: count() }).from(schema.orderItems)
  if (Number(ref.n) > 0) {
    throw new Error('存在订单数据引用商品, 无法重置 fixtures; 请先清理订单数据')
  }
  await db.delete(schema.productSkus)
  await db.delete(schema.products)
  await db.delete(schema.categories)
}

async function main() {
  const logger = createLogger(env.LOG_LEVEL)
  const db = createDb(env.DATABASE_URL)
  try {
    if (process.argv.includes('--reset')) {
      await resetFixtures(db)
      logger.info('fixtures reset: categories/products/skus cleared')
    }
    let products = 0
    let skus = 0
    for (const c of FIXTURES) {
      const categoryId = await upsertCategory(db, c)
      for (const p of c.products) {
        await upsertProduct(db, p, categoryId)
        products += 1
        skus += p.skus.length
      }
    }
    logger.info(
      { categories: FIXTURES.length, products, skus },
      `fixtures ready: ${FIXTURES.length} categories, ${products} products, ${skus} skus`,
    )
  } finally {
    await closeDb(db)
  }
}

main().catch((err) => {
  console.error(`[fixtures] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
