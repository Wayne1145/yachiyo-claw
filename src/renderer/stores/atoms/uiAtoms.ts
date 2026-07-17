import { atom } from 'jotai'
import { atomFamily, atomWithStorage } from 'jotai/utils'
import type React from 'react'
import type { RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import platform from '@/platform'
import type { KnowledgeBase, MessagePicture, Toast } from '../../../shared/types'
import type { PreConstructedMessageState } from '../../types/input-box'

// Input box related state
const defaultPreConstructedMessageState = (): PreConstructedMessageState => ({
  draftMessageId: undefined,
  text: '',
  pictureKeys: [],
  attachments: [],
  links: [],
  preprocessedFiles: [],
  preprocessedLinks: [],
  preprocessingStatus: {
    files: {},
    links: {},
  },
  preprocessingPromises: {
    files: new Map<string, Promise<unknown>>(),
    links: new Map<string, Promise<unknown>>(),
  },
})

export const inputBoxLinksFamily = atomFamily((_sessionId: string) => atom<{ url: string }[]>([]))
export const inputBoxPreConstructedMessageFamily = atomFamily((_sessionId: string) =>
  atom(defaultPreConstructedMessageState())
)

// Atom to store collapsed state of providers
export const collapsedProvidersAtom = atomWithStorage<Record<string, boolean>>('collapsedProviders', {})
