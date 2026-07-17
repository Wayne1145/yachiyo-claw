import type { KnowledgeBase } from '@shared/types'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import * as atoms from '@/stores/atoms'
import { useUIStore } from '@/stores/uiStore'

export function useKnowledgeBase({ isNewSession }: { isNewSession: boolean }) {
  const currentSessionId = useAtomValue(atoms.currentSessionIdAtom)

  const newSessionState = useUIStore((s) => s.newSessionState)
  const setNewSessionState = useUIStore((s) => s.setNewSessionState)
  const sessionKnowledgeBaseMap = useUIStore((s) => s.sessionKnowledgeBaseMap)
  const addSessionKnowledgeBase = useUIStore((s) => s.addSessionKnowledgeBase)
  const removeSessionKnowledgeBase = useUIStore((s) => s.removeSessionKnowledgeBase)

  const knowledgeBase = isNewSession
    ? newSessionState.knowledgeBase
    : currentSessionId
      ? sessionKnowledgeBaseMap[currentSessionId]
      : undefined
  const setKnowledgeBase = useCallback(
    (value: Pick<KnowledgeBase, 'id' | 'name'> | undefined) => {
      if (isNewSession) {
        setNewSessionState((prev) => ({ ...prev, knowledgeBase: value }))
      } else if (currentSessionId) {
        if (value === undefined) {
          removeSessionKnowledgeBase(currentSessionId)
        } else {
          addSessionKnowledgeBase(currentSessionId, value)
        }
      }
    },
    [currentSessionId, isNewSession, setNewSessionState, addSessionKnowledgeBase, removeSessionKnowledgeBase]
  )
  return { knowledgeBase, setKnowledgeBase }
}
