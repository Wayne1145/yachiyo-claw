import NiceModal from '@ebay/nice-modal-react'
import type { Session } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'
import { Box } from '@mantine/core'
import Header from '../layout/Header'

const meta: Meta<typeof Header> = {
  title: 'Real Components/Header',
  component: Header,
  parameters: {
    docs: {
      description: {
        component:
          'The actual `Header` component from `src/renderer/components/layout/Header.tsx`. ' +
          'Minimal height header with gradient accent line, breadcrumb-style title, and toolbar.',
      },
    },
  },
  decorators: [
    (Story) => (
      <NiceModal.Provider>
        <Box
          style={{
            maxWidth: 900,
            border: '1px solid var(--chatbox-border-primary)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <Story />
        </Box>
      </NiceModal.Provider>
    ),
  ],
}

export default meta

// ─── Mock Data Factory ──────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `session_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Understanding React Server Components',
    threadName: 'Thread 1',
    type: 'chat',
    messages: [],
    threads: [],
    picUrl: '',
    createdAt: Date.now(),
    ...overrides,
  } as Session
}

// ─── Stories ────────────────────────────────────────────────────────

export const Default: StoryObj<typeof Header> = {
  name: 'Default',
  args: {
    session: makeSession(),
  },
}

export const LongTitle: StoryObj<typeof Header> = {
  name: 'Long Session Title',
  args: {
    session: makeSession({
      name: 'Very Long Session Title That Should Be Truncated With Ellipsis When It Exceeds Available Space',
      threadName: 'Discussion about performance optimization',
    }),
  },
}

export const UntitledSession: StoryObj<typeof Header> = {
  name: 'Untitled Session',
  args: {
    session: makeSession({
      name: 'Untitled',
      threadName: undefined,
    }),
  },
}

export const NoThreadName: StoryObj<typeof Header> = {
  name: 'No Thread Name',
  args: {
    session: makeSession({
      name: 'Quick Chat',
      threadName: undefined,
    }),
  },
}

export const SameThreadNameAsSession: StoryObj<typeof Header> = {
  name: 'Thread Name Same as Session (hidden)',
  args: {
    session: makeSession({
      name: 'React Hooks Discussion',
      threadName: 'React Hooks Discussion',
    }),
  },
}
