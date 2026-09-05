import { fromCents, toCents } from '@epinfresh/shared'

// 运费策略(编排层策略, 由 app 层从 env 组装注入, usecase 不读 process.env):
// 基础运费 + 满额包邮 + 偏远省份加价 + 首重/续重阶梯(按 SKU 克重累计)。
// 生鲜场景: 偏远省份(新疆/西藏等)不参与包邮, 超重包裹按续重加收。
export interface ShippingFeeConfig {
  // 固定运费(分) —— 非偏远省份的首重运费
  flatFeeCents: bigint
  // 满额包邮阈值(分, 按商品合计计); null = 不启用包邮, 始终收基础运费
  freeThresholdCents: bigint | null
  // 偏远省份名单(与地址 province 精确匹配); 命中省份不参与包邮并叠加 remoteFeeCents
  remoteProvinces?: string[]
  // 偏远省份加收运费(分), 叠加在 flatFeeCents 之上
  remoteFeeCents?: bigint
  // 首重重量(克); 超出部分按 weightAdditionalGrams 分段收取续重费
  weightBaseGrams?: number
  // 续重分段重量(克)
  weightAdditionalGrams?: number
  // 每续重分段加收(分)
  weightAdditionalFeeCents?: bigint
}

export interface ShippingFeeInput {
  // 商品合计金额(分)
  goodsCents: bigint
  // 全部 SKU 合计克重
  totalWeightGrams: number
  // 收货省份(与 remoteProvinces 匹配决定是否加收/参与包邮)
  province: string
}

// 多维度运费计算: 满额包邮(仅非偏远) → 基础运费(偏远按 remoteFee) → 续重加收。
// 续重单位重量不足一个分段按一段计(如 2.3kg 超首重 1kg → 2 个续重段)。
export function computeShippingFee(input: ShippingFeeInput, config: ShippingFeeConfig): bigint {
  const { goodsCents, totalWeightGrams = 0, province = '' } = input
  const remoteProvinces = config.remoteProvinces ?? []
  const isRemote = remoteProvinces.some((p) => p === province.trim())

  const freeThresholdCents = config.freeThresholdCents
  if (!isRemote && freeThresholdCents !== null && goodsCents >= freeThresholdCents) {
    return 0n
  }

  let fee = isRemote ? (config.remoteFeeCents ?? 0n) : config.flatFeeCents

  const baseGrams = config.weightBaseGrams ?? 1000
  const additionalGrams = config.weightAdditionalGrams ?? 1000
  const additionalFeeCents = config.weightAdditionalFeeCents ?? 0n
  if (additionalFeeCents > 0n) {
    const excess = Math.max(0, totalWeightGrams - baseGrams)
    if (excess > 0) {
      const units = Math.ceil(excess / Math.max(1, additionalGrams))
      fee += BigInt(units) * additionalFeeCents
    }
  }
  return fee
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

// env 逗号分隔省份列表 → string[]; 空白项过滤
export function parseCommaList(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// env 克数(字符串数字) → number; 无效回退默认值
export function gramsOr(raw: string | undefined, fallback: number): number {
  if (!raw || !/^\d+$/.test(raw.trim())) return fallback
  return Number(raw.trim())
}

// 预览端点用: 分 → 元字符串(两位小数)
export function centsToYuan(cents: bigint): string {
  return fromCents(cents)
}
