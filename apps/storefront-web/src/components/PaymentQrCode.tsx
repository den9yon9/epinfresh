import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function PaymentQrCode({ codeUrl }: { codeUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(codeUrl, { width: 220, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [codeUrl])

  if (failed) {
    return <p className="text-sm text-gray-400">二维码生成失败，请刷新页面重试</p>
  }
  if (dataUrl === null) {
    return <div className="h-[220px] w-[220px] animate-pulse rounded-lg bg-gray-100" />
  }
  return <img src={dataUrl} alt="支付二维码" width={220} height={220} className="rounded-lg" />
}
