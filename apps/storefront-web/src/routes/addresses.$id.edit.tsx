import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/addresses/$id/edit')({
  staticData: { title: '编辑地址', showBack: true },
  component: () => <Placeholder title="编辑地址" />,
})
