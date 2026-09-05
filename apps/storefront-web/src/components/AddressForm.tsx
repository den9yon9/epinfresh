import { useState } from 'react'

import type { Address } from '../libs/api/types'

export interface AddressFormValues {
  recipientName: string
  phone: string
  province: string
  city: string
  district: string
  detail: string
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
  const [province, setProvince] = useState(initial?.province ?? '')
  const [city, setCity] = useState(initial?.city ?? '')
  const [district, setDistrict] = useState(initial?.district ?? '')
  const [detail, setDetail] = useState(initial?.detail ?? '')
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await onSubmit({
      recipientName,
      phone,
      province,
      city,
      district,
      detail,
      isDefault,
    })
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
          inputMode="numeric"
          pattern="1[3-9]\d{9}"
          title="请输入 11 位手机号"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">省 / 直辖市</span>
        <input
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          required
          placeholder="如：上海市 / 浙江省"
          className={inputCls}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-gray-600">城市</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="如：杭州市（可选）"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-gray-600">区 / 县</span>
          <input
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            placeholder="如：西湖区（可选）"
            className={inputCls}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm text-gray-600">详细地址</span>
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          required
          placeholder="街道、门牌号、小区楼栋等"
          className={inputCls}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
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

// 地址展示拼接: 省市区(非空段)+详情
export function addressLineText(addr: {
  province: string
  city: string
  district: string
  detail: string
}): string {
  return `${addr.province}${addr.city}${addr.district}${addr.detail}`.replace(/undefined/g, '')
}
