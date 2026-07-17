import type { MessageReasoningPart, MessageToolCallPart } from '@shared/types'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'
import { Box, Stack, Text } from '@mantine/core'
import { ToolCallPartUI, ReasoningContentUI } from '../message-parts/ToolCallPartUI'

// ─── ToolCallPartUI Stories ─────────────────────────────────────────

const toolCallMeta: Meta<typeof ToolCallPartUI> = {
  title: 'Real Components/ToolCallPartUI',
  component: ToolCallPartUI,
  parameters: {
    docs: {
      description: {
        component:
          'The actual `ToolCallPartUI` component from `src/renderer/components/message-parts/ToolCallPartUI.tsx`. ' +
          'Renders tool call status as a compact pill with expandable details.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Box p="lg" style={{ maxWidth: 600 }}>
        <Story />
      </Box>
    ),
  ],
}

export default toolCallMeta

// ─── Mock Data Factories ────────────────────────────────────────────

function makeToolCallPart(overrides: Record<string, unknown> = {}): MessageToolCallPart {
  return {
    type: 'tool-call' as const,
    state: 'result' as const,
    toolCallId: `call_${Math.random().toString(36).slice(2, 10)}`,
    toolName: 'web_search',
    args: {},
    ...overrides,
  } as MessageToolCallPart
}

// ─── Stories ────────────────────────────────────────────────────────

export const WebSearchLoading: StoryObj<typeof ToolCallPartUI> = {
  name: 'Web Search — Loading',
  args: {
    part: makeToolCallPart({
      toolName: 'web_search',
      state: 'call',
      args: { query: 'React Server Components vs SSR' },
    }),
  },
}

export const WebSearchSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Web Search — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'web_search',
      state: 'result',
      args: { query: 'React Server Components vs SSR' },
      result: {
        query: 'React Server Components vs SSR',
        searchResults: [
          {
            title: 'Understanding React Server Components',
            snippet: 'React Server Components allow rendering on the server without sending JS to the client...',
            link: 'https://example.com/react-rsc',
          },
          {
            title: 'SSR vs RSC: What is the difference?',
            snippet: 'While SSR renders the full page on the server, RSC allows component-level server rendering...',
            link: 'https://example.com/ssr-vs-rsc',
          },
          {
            title: 'Next.js App Router and Server Components',
            snippet: 'The App Router in Next.js 13+ uses React Server Components by default for all pages...',
            link: 'https://example.com/nextjs-app-router',
          },
        ],
      },
    }),
  },
}

export const WebSearchError: StoryObj<typeof ToolCallPartUI> = {
  name: 'Web Search — Error',
  args: {
    part: makeToolCallPart({
      toolName: 'web_search',
      state: 'error',
      args: { query: 'React Server Components' },
    }),
  },
}

export const CodeSearchSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Code Search — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'code_search',
      state: 'result',
      args: { query: 'useEffect cleanup' },
      result: { matches: 3 },
    }),
  },
}

export const KnowledgeBaseLoading: StoryObj<typeof ToolCallPartUI> = {
  name: 'Knowledge Base — Loading',
  args: {
    part: makeToolCallPart({
      toolName: 'query_knowledge_base',
      state: 'call',
      args: { query: 'authentication flow' },
    }),
  },
}

export const TerminalSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Terminal — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'terminal',
      state: 'result',
      args: { command: 'ls -la' },
      result: { output: 'total 48\ndrwxr-xr-x  12 user  staff  384 Mar  5 10:00 .\n...' },
    }),
  },
}

export const ReadFileSuccess: StoryObj<typeof ToolCallPartUI> = {
  name: 'Read File — Success',
  args: {
    part: makeToolCallPart({
      toolName: 'read_file',
      state: 'result',
      args: { path: 'src/index.ts' },
      result: { content: 'import { app } from "electron"\n...' },
    }),
  },
}

export const ParseLinkLoading: StoryObj<typeof ToolCallPartUI> = {
  name: 'Parse Link — Loading',
  args: {
    part: makeToolCallPart({
      toolName: 'parse_link',
      state: 'call',
      args: { url: 'https://example.com/article' },
    }),
  },
}

export const MultiplePills: StoryObj = {
  name: 'Multiple Tool Calls',
  render: () => (
    <Stack gap="xs">
      <Text size="sm" c="dimmed" mb="xs">
        Multiple tool calls in a single message:
      </Text>
      <ToolCallPartUI
        part={makeToolCallPart({
          toolName: 'web_search',
          state: 'result',
          args: { query: 'React hooks best practices' },
          result: {
            query: 'React hooks best practices',
            searchResults: [
              { title: 'React Hooks Guide', snippet: 'Best practices for hooks...', link: 'https://example.com' },
            ],
          },
        })}
      />
      <ToolCallPartUI
        part={makeToolCallPart({
          toolName: 'read_file',
          state: 'result',
          args: { path: 'package.json' },
          result: { content: '{ "name": "chatbox" }' },
        })}
      />
      <ToolCallPartUI
        part={makeToolCallPart({
          toolName: 'terminal',
          state: 'call',
          args: { command: 'npm test' },
        })}
      />
    </Stack>
  ),
}
