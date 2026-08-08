import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/addresses')({
  staticData: { title: '地址管理', showBack: true },
  component: () => <Placeholder title="地址管理" />,
})
