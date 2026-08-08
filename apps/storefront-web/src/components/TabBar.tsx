import { Link, useLocation } from '@tanstack/react-router'

const TABS = [
  { to: '/', label: '首页', icon: HomeIcon },
  { to: '/cart', label: '购物车', icon: CartIcon },
  { to: '/me', label: '我的', icon: UserIcon },
] as const

export function TabBar() {
  const pathname = useLocation({ select: (l) => l.pathname })
  if (!TABS.some((t) => t.to === pathname)) return null
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl">
        {TABS.map((t) => {
          const active = t.to === pathname
          return (
            <Link
              key={t.to}
              to={t.to}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
                active ? 'text-brand-600' : 'text-gray-500'
              }`}
            >
              <t.icon />
              <span>{t.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v10h13V10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 4h2l2.5 12h10l2.5-8H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="20" r="1.5" />
      <circle cx="17" cy="20" r="1.5" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" strokeLinecap="round" />
    </svg>
  )
}
