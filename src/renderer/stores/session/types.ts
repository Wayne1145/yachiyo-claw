import type { Message, Session } from '@shared/types'

export type MessageForkEntry = NonNullable<Session['messageForksHash']>[string]
export type MessageLocation = { list: Message[]; index: number }
