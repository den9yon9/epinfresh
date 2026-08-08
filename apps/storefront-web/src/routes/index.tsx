import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return <p className="text-gray-500">商城搭建中，敬请期待</p>
}
