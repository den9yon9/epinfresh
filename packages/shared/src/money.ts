export function toCents(amount: string): bigint {
  const s = String(amount)
  const dot = s.indexOf('.')
  if (dot === -1) return BigInt(s) * 100n
  const int = s.slice(0, dot)
  const frac = (s.slice(dot + 1) + '00').slice(0, 2)
  return BigInt(int || '0') * 100n + BigInt(frac)
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}
