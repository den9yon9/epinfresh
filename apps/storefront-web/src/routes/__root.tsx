import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="app">
      <header className="header">
        <Link to="/" className="brand">
          一品鲜
        </Link>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
