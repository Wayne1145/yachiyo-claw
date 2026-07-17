import { useQuery } from '@tanstack/react-query'
import * as chatStore from '@/stores/chatStore'
import { QueryKeys } from '@/stores/chatStore'

export function useSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: QueryKeys.ChatSession(sessionId ?? ''),
    queryFn: () => {
      if (!sessionId) return null
      return chatStore.getSession(sessionId)
    },
    enabled: !!sessionId,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useSessionSettings(sessionId: string | undefined) {
  return useQuery({
    queryKey: QueryKeys.ChatSessionSettings(sessionId ?? ''),
    queryFn: () => {
      if (!sessionId) return null
      return chatStore.getSessionSettings(sessionId)
    },
    enabled: !!sessionId,
  })
}
