import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/addresses/new')({
  staticData: { title: '新增地址', showBack: true },
  component: () => <Placeholder title="新增地址" />,
})
