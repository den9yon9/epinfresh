import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/checkout')({
  staticData: { title: '结算', showBack: true },
  component: () => <Placeholder title="结算" />,
})
