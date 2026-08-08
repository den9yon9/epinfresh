import { createRootRoute, Outlet } from '@tanstack/react-router'

import { Header } from '../components/Header'
import { TabBar } from '../components/TabBar'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-4 md:px-6">
        <Outlet />
      </main>
      <TabBar />
    </div>
  )
}
