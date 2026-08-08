import { createFileRoute } from '@tanstack/react-router'

import { Placeholder } from '../components/Placeholder'

export const Route = createFileRoute('/me')({
  component: () => <Placeholder title="我的" />,
})
