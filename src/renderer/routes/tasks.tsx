import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/tasks')({
  component: TasksRoute,
})

function TasksRoute() {
  return null
}
