import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/register')({
  staticData: { title: '注册', showBack: true },
  component: () => <Placeholder title="注册" />,
})
