import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/login')({
  staticData: { title: '登录', showBack: true },
  component: () => <Placeholder title="登录" />,
})
