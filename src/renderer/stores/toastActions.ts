import { uiStore } from './uiStore'

export function add(content: string, duration?: number) {
  uiStore.getState().addToast(content, duration)
}

export function remove(id: string) {
  uiStore.getState().removeToast(id)
}
