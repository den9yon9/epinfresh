import { Link, useRouter, useRouterState } from '@tanstack/react-router'

// ponytail: staticData 类型太松, 读侧用窄接口断言
interface PageMeta {
  title?: string
  showBack?: boolean
}

export function Header() {
  const router = useRouter()
  const meta = useRouterState({
    select: (s) => {
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const m = s.matches[i].staticData as PageMeta | undefined
        if (m) return m
      }
      return undefined
    },
  })

  if (meta?.showBack) {
    return (
      <header className="sticky top-0 z-10 flex h-12 items-center gap-1 border-b border-gray-200 bg-white px-2 md:px-4">
        <button
          onClick={() => router.history.back()}
          aria-label="返回"
          className="flex h-10 w-10 items-center justify-center text-gray-600"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-base font-semibold">{meta.title}</span>
      </header>
    )
  }

  return (
    <header className="flex h-12 items-center px-4 bg-brand-600 text-white md:px-6">
      <Link to="/" className="text-xl font-bold">
        一品鲜
      </Link>
    </header>
  )
}
