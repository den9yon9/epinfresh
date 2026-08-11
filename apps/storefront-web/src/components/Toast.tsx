import { useEffect, type ReactNode } from 'react'

interface ToastProps {
  message: string | null
  onDismiss: () => void
  action?: ReactNode
}

export function Toast({ message, onDismiss, action }: ToastProps) {
  useEffect(() => {
    if (message === null) return
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [message, onDismiss])

  if (message === null) return null
  return (
    <div className="fixed inset-x-0 top-20 z-20 mx-auto flex w-fit items-center gap-3 rounded-full bg-gray-900/80 px-4 py-1.5 text-sm text-white">
      <span>{message}</span>
      {action}
    </div>
  )
}
