import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/pay')({
  staticData: { title: '支付', showBack: true },
  component: () => <Placeholder title="支付" />,
})
