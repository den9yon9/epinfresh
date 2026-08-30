import { fromCents, toCents } from '@epinfresh/shared'

// 运费策略(编排层策略, 由 app 层从 env 组装注入, usecase 不读 process.env):
// 固定运费 + 满额包邮。地区/重量维度待地址结构化与 SKU 重量字段后扩展(tech-debt)。
export interface ShippingFeeConfig {
  // 固定运费(分)
  flatFeeCents: bigint
  // 满额包邮阈值(分, 按商品合计计); null = 不启用包邮, 始终收固定运费
  freeThresholdCents: bigint | null
}

// 商品合计达到阈值 → 免运费; 否则收固定运费
export function computeShippingFee(goodsCents: bigint, config: ShippingFeeConfig): bigint {
  if (config.freeThresholdCents !== null && goodsCents >= config.freeThresholdCents) return 0n
  return config.flatFeeCents
}

// env 值(元字符串) → 分。空串/无效回退 0: 运费默认关闭, 向后兼容
export function yuanToCentsOrZero(raw: string | undefined): bigint {
  if (!raw || raw.trim() === '') return 0n
  try {
    return toCents(raw.trim())
  } catch {
    return 0n
  }
}

// env 值(元字符串) → 分。空串 = 未启用 → null
export function yuanToCentsOrNull(raw: string | undefined): bigint | null {
  if (!raw || raw.trim() === '') return null
  try {
    return toCents(raw.trim())
  } catch {
    return null
  }
}

// 预览端点用: 分 → 元字符串(两位小数)
export function centsToYuan(cents: bigint): string {
  return fromCents(cents)
}
