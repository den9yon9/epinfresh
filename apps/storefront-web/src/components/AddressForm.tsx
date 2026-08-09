import { useState } from 'react'

import type { Address } from '../libs/api/types'

export interface AddressFormValues {
  recipientName: string
  phone: string
  address: string
  isDefault: boolean
}

interface AddressFormProps {
  initial?: Address
  submitLabel: string
  onSubmit: (
    values: AddressFormValues,
  ) => Promise<{ error: { value: { message?: string } } | null }>
  onDone: () => void
}

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-brand-500 focus:outline-none'

export function AddressForm({ initial, submitLabel, onSubmit, onDone }: AddressFormProps) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [recipientName, setRecipientName] = useState(initial?.recipientName ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await onSubmit({ recipientName, phone, address, isDefault })
    setSubmitting(false)
    if (res.error) {
      setError(res.error.value.message ?? '保存失败')
      return
    }
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">收件人</span>
        <input
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
          required
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">手机号</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">详细地址</span>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
          className={inputCls}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-4 w-4 accent-brand-600"
        />
        设为默认地址
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-brand-600 py-2.5 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? '保存中…' : submitLabel}
      </button>
    </form>
  )
}
