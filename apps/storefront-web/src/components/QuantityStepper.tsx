import { useState } from 'react'

interface QuantityStepperProps {
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function QuantityStepper({ value, min = 1, max = 999, onChange }: QuantityStepperProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const parsed = Number(draft)
    setDraft(null)
    if (Number.isFinite(parsed) && parsed > 0) onChange(clamp(Math.floor(parsed), min, max))
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(clamp(value - 1, min, max))}
        disabled={value <= min}
        aria-label="减少数量"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        value={draft ?? value}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        aria-label="数量"
        className="h-8 w-12 rounded-lg border border-gray-300 text-center text-base font-semibold focus:border-brand-500 focus:outline-none"
      />
      <button
        onClick={() => onChange(clamp(value + 1, min, max))}
        disabled={value >= max}
        aria-label="增加数量"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}
