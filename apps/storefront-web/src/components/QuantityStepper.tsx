interface QuantityStepperProps {
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}

export function QuantityStepper({ value, min = 1, max = 999, onChange }: QuantityStepperProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 disabled:opacity-40"
      >
        −
      </button>
      <span className="w-8 text-center text-base font-semibold">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-gray-600 disabled:opacity-40"
      >
        +
      </button>
    </div>
  )
}
