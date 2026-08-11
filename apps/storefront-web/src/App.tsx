import { Link, RouterProvider, createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'
import './styles.css'

const router = createRouter({
  routeTree,
  // 返回时恢复上次滚动位置(如商品列表); 前进/新导航仍回顶
  scrollRestoration: true,
  defaultErrorComponent: ({ error, reset }) => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-red-600">页面出错了：{error.message}</p>
      <button
        onClick={() => reset()}
        className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
      >
        重试
      </button>
    </div>
  ),
  defaultNotFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-gray-500">页面不存在</p>
      <Link to="/" className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">
        返回首页
      </Link>
    </div>
  ),
  defaultPendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center text-gray-500">加载中…</div>
  ),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return <RouterProvider router={router} />
}
