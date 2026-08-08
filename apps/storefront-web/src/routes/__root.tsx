import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center px-6 bg-green-600 text-white">
        <Link to="/" className="text-xl font-bold">
          一品鲜
        </Link>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
