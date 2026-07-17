import {
  ActionIcon,
  Badge,
  Box,
  Code,
  Collapse,
  Flex,
  Group,
  Paper,
  Progress,
  RingProgress,
  SimpleGrid,
  Space,
  Stack,
  Text,
  ThemeIcon,
  Timeline,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import {
  IconArrowRight,
  IconBrain,
  IconBrandChrome,
  IconBulb,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconCode,
  IconCopy,
  IconDatabase,
  IconExternalLink,
  IconFileSearch,
  IconLoader,
  IconSearch,
  IconSparkles,
  IconTerminal,
  IconTool,
  IconWorld,
} from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import clsx from 'clsx'
import React, { useState } from 'react'

const meta: Meta = {
  title: 'Chat/Tool Call Part',
  parameters: {
    docs: {
      description: {
        component: `
## Tool Call Part UI - Design Exploration

Explores different visual treatments for tool call rendering in messages.

### Current Issues
1. **Low information density**: The header uses a full-width bordered Paper just to show tool name + status icon
2. **Generic appearance**: All tool calls look identical regardless of tool type
3. **Expanded view is raw JSON**: Arguments and results are shown as raw JSON dumps, hard to scan
4. **No progress indication**: Loading state is just a spinning icon, no sense of what's happening
5. **Wrench icon is redundant**: Always shown next to every tool call, adds visual noise

### Design Goals
- More compact default (collapsed) state
- Better visual hierarchy between tool name, status, and details
- Tool-type-specific icons for quick recognition
- Cleaner expanded view with structured data display
- Better loading/progress indication
        `,
      },
    },
  },
}

export default meta

// ─── Helpers ────────────────────────────────────────────────────────

const Wrapper = ({
  children,
  label,
  description,
}: {
  children: React.ReactNode
  label: string
  description?: string
}) => (
  <Stack gap="xs" mb="xl">
    <Box>
      <Text fw={700} size="sm">
        {label}
      </Text>
      {description && (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      )}
    </Box>
    <Box style={{ maxWidth: 680 }}>{children}</Box>
  </Stack>
)

const toolIconMap: Record<string, React.ElementType> = {
  web_search: IconWorld,
  terminal: IconTerminal,
  code_search: IconFileSearch,
  query_knowledge_base: IconDatabase,
  parse_link: IconBrandChrome,
}

const getToolIcon = (toolName: string) => toolIconMap[toolName] || IconTool

// ─── Current Design (as-is) ────────────────────────────────────────

export const CurrentDesign: StoryObj = {
  name: 'Current: General Tool Call',
  render: () => {
    const [expanded, setExpanded] = useState(false)
    return (
      <Wrapper
        label="Current Design"
        description="Bordered Paper header with wrench icon + status icon, raw JSON in expanded view"
      >
        <Stack gap="xs">
          {/* Call state */}
          <Paper withBorder radius="md" px="xs" className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
            <Group justify="space-between" className="w-full">
              <Group gap="xs">
                <Text fw={600}>Web Search</Text>
                <IconTool size={16} color="var(--chatbox-tint-success)" />
                <IconLoader size={16} className="animate-spin" color="var(--chatbox-tint-brand)" />
              </Group>
              <Space miw="xl" />
              <IconChevronRight size={16} className={clsx('transition-transform', expanded ? 'rotate-90' : '')} />
            </Group>
          </Paper>

          {/* Result state */}
          <Paper withBorder radius="md" px="xs" className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
            <Group justify="space-between" className="w-full">
              <Group gap="xs">
                <Text fw={600}>Query Knowledge Base</Text>
                <IconTool size={16} color="var(--chatbox-tint-success)" />
                <IconCircleCheckFilled size={16} color="var(--chatbox-tint-success)" />
              </Group>
              <Space miw="xl" />
              <IconChevronRight size={16} className={clsx('transition-transform', expanded ? 'rotate-90' : '')} />
            </Group>
          </Paper>

          {/* Error state */}
          <Paper withBorder radius="md" px="xs" className="cursor-pointer">
            <Group justify="space-between" className="w-full">
              <Group gap="xs">
                <Text fw={600}>Terminal</Text>
                <IconTool size={16} color="var(--chatbox-tint-success)" />
                <IconCircleXFilled size={16} color="var(--chatbox-tint-error)" />
              </Group>
              <Space miw="xl" />
              <IconChevronRight size={16} />
            </Group>
          </Paper>

          {/* Expanded view */}
          <Paper withBorder radius="md" px="xs" className="cursor-pointer">
            <Group justify="space-between" className="w-full">
              <Group gap="xs">
                <Text fw={600}>Code Search</Text>
                <IconTool size={16} color="var(--chatbox-tint-success)" />
                <IconCircleCheckFilled size={16} color="var(--chatbox-tint-success)" />
              </Group>
              <Space miw="xl" />
              <IconChevronRight size={16} className="rotate-90 transition-transform" />
            </Group>
          </Paper>
          <Paper withBorder radius="md" p="sm">
            <Stack gap="xs">
              <Group gap="xs" c="chatbox-tertiary">
                <IconCode size={16} />
                <Text fw={600} size="xs" c="chatbox-tertiary" m="0">
                  Arguments
                </Text>
              </Group>
              <Code block>{JSON.stringify({ query: 'how to implement RAG', max_results: 5 }, null, 2)}</Code>
              <Group gap="xs" c="chatbox-tertiary" mt="xs">
                <IconArrowRight size={16} />
                <Text fw={600} size="xs" c="chatbox-tertiary" m="0">
                  Result
                </Text>
              </Group>
              <Code block>
                {JSON.stringify(
                  {
                    matches: [
                      { file: 'rag.ts', score: 0.95 },
                      { file: 'embed.ts', score: 0.87 },
                    ],
                  },
                  null,
                  2
                )}
              </Code>
            </Stack>
          </Paper>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Option A: Inline Pill ─────────────────────────────────────────

export const OptionA_InlinePill: StoryObj = {
  name: 'Option A: Inline Pill (Compact)',
  render: () => {
    const [expanded, setExpanded] = useState<string | null>(null)
    return (
      <Wrapper
        label="Option A: Inline Pill"
        description="Minimal footprint — tool calls rendered as compact inline pills. Clicking expands details below. Good for conversations with many tool calls."
      >
        <Stack gap={6}>
          {/* Loading state */}
          <UnstyledButton>
            <Group
              gap={6}
              px={10}
              py={4}
              style={{
                borderRadius: 'var(--mantine-radius-xl)',
                backgroundColor: 'var(--chatbox-background-gray-secondary)',
                display: 'inline-flex',
              }}
            >
              <IconWorld size={14} color="var(--chatbox-tint-brand)" />
              <Text size="xs" fw={500}>
                Web Search
              </Text>
              <IconLoader size={12} className="animate-spin" color="var(--chatbox-tint-brand)" />
            </Group>
          </UnstyledButton>

          {/* Success state */}
          <UnstyledButton onClick={() => setExpanded(expanded === 'kb' ? null : 'kb')}>
            <Group
              gap={6}
              px={10}
              py={4}
              style={{
                borderRadius: 'var(--mantine-radius-xl)',
                backgroundColor: 'var(--chatbox-background-gray-secondary)',
                display: 'inline-flex',
              }}
            >
              <IconDatabase size={14} color="var(--chatbox-tint-success)" />
              <Text size="xs" fw={500}>
                Knowledge Base
              </Text>
              <IconCheck size={12} color="var(--chatbox-tint-success)" />
              <IconChevronDown
                size={12}
                color="var(--chatbox-tertiary)"
                className={clsx('transition-transform', expanded === 'kb' ? 'rotate-180' : '')}
              />
            </Group>
          </UnstyledButton>
          <Collapse in={expanded === 'kb'}>
            <Paper
              radius="md"
              p="xs"
              ml={4}
              style={{
                backgroundColor: 'var(--chatbox-background-gray-secondary)',
                borderLeft: '2px solid var(--chatbox-tint-success)',
              }}
            >
              <Group gap={4} mb={4}>
                <Text size="xs" c="chatbox-tertiary" fw={500}>
                  query:
                </Text>
                <Text size="xs" fs="italic">
                  "RAG implementation patterns"
                </Text>
              </Group>
              <Group gap={4}>
                <Text size="xs" c="chatbox-tertiary" fw={500}>
                  results:
                </Text>
                <Text size="xs">3 matches found</Text>
              </Group>
            </Paper>
          </Collapse>

          {/* Error state */}
          <UnstyledButton>
            <Group
              gap={6}
              px={10}
              py={4}
              style={{
                borderRadius: 'var(--mantine-radius-xl)',
                backgroundColor: 'color-mix(in srgb, var(--chatbox-tint-error) 8%, transparent)',
                display: 'inline-flex',
              }}
            >
              <IconTerminal size={14} color="var(--chatbox-tint-error)" />
              <Text size="xs" fw={500} c="chatbox-error">
                Terminal
              </Text>
              <IconCircleXFilled size={12} color="var(--chatbox-tint-error)" />
            </Group>
          </UnstyledButton>

          {/* Multiple pills in a row (common pattern) */}
          <Box mt="md">
            <Text size="xs" c="dimmed" mb={6}>
              Multiple tool calls inline:
            </Text>
            <Group gap={6}>
              {['Web Search', 'Knowledge Base', 'Code Search'].map((name, i) => (
                <Group
                  key={name}
                  gap={6}
                  px={10}
                  py={4}
                  style={{
                    borderRadius: 'var(--mantine-radius-xl)',
                    backgroundColor: 'var(--chatbox-background-gray-secondary)',
                    display: 'inline-flex',
                  }}
                >
                  {React.createElement([IconWorld, IconDatabase, IconFileSearch][i], {
                    size: 14,
                    color: 'var(--chatbox-tint-success)',
                  })}
                  <Text size="xs" fw={500}>
                    {name}
                  </Text>
                  <IconCheck size={12} color="var(--chatbox-tint-success)" />
                </Group>
              ))}
            </Group>
          </Box>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Option B: Card with Structured Details ─────────────────────────

export const OptionB_StructuredCard: StoryObj = {
  name: 'Option B: Structured Card',
  render: () => {
    const [expanded, setExpanded] = useState(true)
    return (
      <Wrapper
        label="Option B: Structured Card"
        description="Clean card with tool-specific icon, status badge, and structured (non-JSON) expanded content. Better visual hierarchy."
      >
        <Stack gap="sm">
          {/* Loading */}
          <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <Group px="sm" py={8} justify="space-between" className="cursor-pointer">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="blue" radius="xl">
                  <IconWorld size={12} />
                </ThemeIcon>
                <Text size="sm" fw={600}>
                  Web Search
                </Text>
                <Badge
                  size="xs"
                  variant="light"
                  color="blue"
                  leftSection={<IconLoader size={10} className="animate-spin" />}
                >
                  searching...
                </Badge>
              </Group>
              <IconChevronRight size={14} color="var(--chatbox-tertiary)" />
            </Group>
            <Progress size={2} value={65} animated color="blue" />
          </Paper>

          {/* Success - collapsed */}
          <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <Group px="sm" py={8} justify="space-between" className="cursor-pointer">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="teal" radius="xl">
                  <IconDatabase size={12} />
                </ThemeIcon>
                <Text size="sm" fw={600}>
                  Knowledge Base
                </Text>
                <Badge size="xs" variant="light" color="teal">
                  3 results
                </Badge>
              </Group>
              <IconChevronRight size={14} color="var(--chatbox-tertiary)" />
            </Group>
          </Paper>

          {/* Success - expanded */}
          <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <UnstyledButton w="100%" onClick={() => setExpanded(!expanded)}>
              <Group px="sm" py={8} justify="space-between">
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="teal" radius="xl">
                    <IconFileSearch size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Code Search
                  </Text>
                  <Badge size="xs" variant="light" color="teal">
                    2 matches
                  </Badge>
                </Group>
                <IconChevronRight
                  size={14}
                  color="var(--chatbox-tertiary)"
                  className={clsx('transition-transform', expanded ? 'rotate-90' : '')}
                />
              </Group>
            </UnstyledButton>
            <Collapse in={expanded}>
              <Box px="sm" pb="sm" style={{ borderTop: '1px solid var(--paper-border-color)' }}>
                <Stack gap={6} mt="xs">
                  <Group gap={6}>
                    <Text size="xs" c="chatbox-tertiary" fw={500} w={60}>
                      Query
                    </Text>
                    <Text size="xs" fs="italic">
                      "implement RAG"
                    </Text>
                  </Group>
                  <Group gap={6} align="flex-start">
                    <Text size="xs" c="chatbox-tertiary" fw={500} w={60}>
                      Results
                    </Text>
                    <Stack gap={4}>
                      <Group gap={4}>
                        <IconCode size={12} color="var(--chatbox-tertiary)" />
                        <Text size="xs" ff="monospace">
                          rag.ts
                        </Text>
                        <Text size="xs" c="chatbox-tertiary">
                          score: 0.95
                        </Text>
                      </Group>
                      <Group gap={4}>
                        <IconCode size={12} color="var(--chatbox-tertiary)" />
                        <Text size="xs" ff="monospace">
                          embed.ts
                        </Text>
                        <Text size="xs" c="chatbox-tertiary">
                          score: 0.87
                        </Text>
                      </Group>
                    </Stack>
                  </Group>
                </Stack>
              </Box>
            </Collapse>
          </Paper>

          {/* Error */}
          <Paper
            withBorder
            radius="md"
            p={0}
            style={{ overflow: 'hidden', borderColor: 'var(--chatbox-border-error)' }}
          >
            <Group px="sm" py={8} justify="space-between" className="cursor-pointer">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="red" radius="xl">
                  <IconTerminal size={12} />
                </ThemeIcon>
                <Text size="sm" fw={600}>
                  Terminal
                </Text>
                <Badge size="xs" variant="light" color="red">
                  failed
                </Badge>
              </Group>
              <IconChevronRight size={14} color="var(--chatbox-tertiary)" />
            </Group>
          </Paper>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Option C: Timeline / Step List ─────────────────────────────────

export const OptionC_Timeline: StoryObj = {
  name: 'Option C: Timeline Steps',
  render: () => (
    <Wrapper
      label="Option C: Timeline / Step List"
      description="Tool calls displayed as a vertical timeline. Great for showing execution order and progress in multi-step workflows."
    >
      <Timeline active={2} bulletSize={24} lineWidth={2} ml={4}>
        <Timeline.Item
          bullet={<IconWorld size={12} />}
          title={
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Web Search
              </Text>
              <Text size="xs" c="chatbox-tertiary">
                "latest React patterns"
              </Text>
            </Group>
          }
        >
          <Group gap={6} mt={4}>
            {['react.dev', 'github.com/react', 'stackoverflow.com'].map((url) => (
              <Badge key={url} size="xs" variant="light" color="gray" leftSection={<IconExternalLink size={10} />}>
                {url}
              </Badge>
            ))}
          </Group>
        </Timeline.Item>

        <Timeline.Item
          bullet={<IconDatabase size={12} />}
          title={
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Knowledge Base
              </Text>
              <Badge size="xs" variant="light" color="teal">
                3 results
              </Badge>
            </Group>
          }
        >
          <Text size="xs" c="chatbox-tertiary" mt={4}>
            Matched: components.md, hooks.md, patterns.md
          </Text>
        </Timeline.Item>

        <Timeline.Item
          bullet={<IconFileSearch size={12} />}
          title={
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Code Search
              </Text>
              <IconLoader size={14} className="animate-spin" color="var(--chatbox-tint-brand)" />
            </Group>
          }
          color="blue"
        >
          <Text size="xs" c="chatbox-tertiary" mt={4}>
            Searching codebase...
          </Text>
        </Timeline.Item>

        <Timeline.Item
          bullet={<IconTerminal size={12} />}
          title={
            <Text size="sm" fw={600} c="chatbox-tertiary">
              Terminal
            </Text>
          }
          color="gray"
        >
          <Text size="xs" c="chatbox-tertiary" mt={4}>
            Pending
          </Text>
        </Timeline.Item>
      </Timeline>
    </Wrapper>
  ),
}

// ─── Option D: Minimal Inline (Claude-style) ────────────────────────

export const OptionD_MinimalInline: StoryObj = {
  name: 'Option D: Minimal Inline (Claude-style)',
  render: () => {
    const [expanded, setExpanded] = useState<string | null>('code')
    return (
      <Wrapper
        label="Option D: Minimal Inline"
        description="Ultra-minimal, text-centric design inspired by Claude.ai. Tool calls feel like part of the text flow rather than separate UI blocks."
      >
        <Stack gap={8}>
          {/* Loading */}
          <UnstyledButton>
            <Group gap={6}>
              <Box
                w={4}
                h={4}
                style={{
                  borderRadius: '50%',
                  backgroundColor: 'var(--chatbox-tint-brand)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <Text size="sm" c="chatbox-tertiary">
                Searching the web...
              </Text>
            </Group>
          </UnstyledButton>

          {/* Success collapsed */}
          <UnstyledButton onClick={() => setExpanded(expanded === 'web' ? null : 'web')}>
            <Group gap={6}>
              <IconCheck size={14} color="var(--chatbox-tint-success)" />
              <Text
                size="sm"
                c="chatbox-secondary"
                td="underline"
                style={{ textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
              >
                Searched the web
              </Text>
              <Text size="xs" c="chatbox-tertiary">
                · 5 results
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse in={expanded === 'web'}>
            <Stack gap={4} ml={20}>
              {[
                'React Server Components – react.dev',
                'RSC Deep Dive – vercel.com',
                'Server vs Client – nextjs.org',
              ].map((r, i) => (
                <Text key={i} size="xs" c="chatbox-tertiary">
                  {i + 1}. {r}
                </Text>
              ))}
            </Stack>
          </Collapse>

          {/* Success expanded */}
          <UnstyledButton onClick={() => setExpanded(expanded === 'code' ? null : 'code')}>
            <Group gap={6}>
              <IconCheck size={14} color="var(--chatbox-tint-success)" />
              <Text
                size="sm"
                c="chatbox-secondary"
                td="underline"
                style={{ textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
              >
                Searched codebase
              </Text>
              <Text size="xs" c="chatbox-tertiary">
                · 2 matches
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse in={expanded === 'code'}>
            <Stack gap={4} ml={20}>
              <Group gap={6}>
                <Text size="xs" ff="monospace" c="chatbox-secondary">
                  src/rag.ts
                </Text>
                <Text size="xs" c="chatbox-tertiary">
                  relevance: 0.95
                </Text>
              </Group>
              <Group gap={6}>
                <Text size="xs" ff="monospace" c="chatbox-secondary">
                  src/embed.ts
                </Text>
                <Text size="xs" c="chatbox-tertiary">
                  relevance: 0.87
                </Text>
              </Group>
            </Stack>
          </Collapse>

          {/* Error */}
          <Group gap={6}>
            <IconCircleXFilled size={14} color="var(--chatbox-tint-error)" />
            <Text size="sm" c="chatbox-error">
              Terminal command failed
            </Text>
            <Tooltip label="Exit code 1: permission denied" withArrow>
              <Text
                size="xs"
                c="chatbox-tertiary"
                td="underline"
                style={{ textDecorationStyle: 'dotted', cursor: 'help' }}
              >
                details
              </Text>
            </Tooltip>
          </Group>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Web Search Comparison ──────────────────────────────────────────

export const WebSearchComparison: StoryObj = {
  name: 'Web Search: Current vs Optimized',
  render: () => {
    const searchResults = [
      {
        title: 'React Server Components – Official Docs',
        link: 'https://react.dev/blog/server-components',
        snippet: 'Server Components let you render...',
      },
      {
        title: 'Understanding RSC Architecture',
        link: 'https://vercel.com/blog/rsc',
        snippet: 'A deep dive into how RSC works...',
      },
      {
        title: 'Server vs Client Components',
        link: 'https://nextjs.org/docs/components',
        snippet: 'Learn when to use each type...',
      },
      {
        title: 'RSC Performance Benefits',
        link: 'https://web.dev/rsc-performance',
        snippet: 'Measuring the impact of RSC...',
      },
    ]

    return (
      <Box p="lg" style={{ maxWidth: 720 }}>
        <Wrapper
          label="Current: Web Search"
          description="Horizontal scroll of result cards when collapsed, grid when expanded"
        >
          <Stack gap="xs">
            <Paper withBorder radius="md" px="xs" className="cursor-pointer">
              <Group justify="space-between" className="w-full">
                <Group gap="xs">
                  <Text fw={600}>Web Search</Text>
                  <IconTool size={16} color="var(--chatbox-tint-success)" />
                  <IconCircleCheckFilled size={16} color="var(--chatbox-tint-success)" />
                </Group>
                <Space miw="xl" />
                <IconChevronRight size={16} />
              </Group>
            </Paper>
            <Group gap="xs" wrap="nowrap" className="overflow-x-auto" pb="xs">
              {searchResults.map((r, i) => (
                <Paper key={i} radius="md" p={8} bg="var(--chatbox-background-gray-secondary)" maw={200}>
                  <Text size="sm" truncate="end">
                    <b>{i + 1}.</b> {r.title}
                  </Text>
                  <Text size="xs" truncate="end" c="chatbox-tertiary" mt={4}>
                    {r.link}
                  </Text>
                </Paper>
              ))}
            </Group>
          </Stack>
        </Wrapper>

        <Wrapper
          label="Optimized: Web Search"
          description="Cleaner header with result count badge, better result cards with favicons and snippet preview"
        >
          <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <Group px="sm" py={8} justify="space-between" className="cursor-pointer">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="teal" radius="xl">
                  <IconSearch size={12} />
                </ThemeIcon>
                <Text size="sm" fw={600}>
                  Web Search
                </Text>
                <Text size="xs" c="chatbox-tertiary" fs="italic">
                  "React Server Components"
                </Text>
                <Badge size="xs" variant="light" color="teal">
                  {searchResults.length} results
                </Badge>
              </Group>
              <IconChevronRight size={14} className="rotate-90 transition-transform" color="var(--chatbox-tertiary)" />
            </Group>
            <Box px="sm" pb="sm" style={{ borderTop: '1px solid var(--paper-border-color)' }}>
              <Stack gap={6} mt="xs">
                {searchResults.map((r, i) => (
                  <Group
                    key={i}
                    gap="xs"
                    px={8}
                    py={6}
                    style={{
                      borderRadius: 'var(--mantine-radius-sm)',
                      backgroundColor: 'var(--chatbox-background-gray-secondary)',
                    }}
                    wrap="nowrap"
                  >
                    <Text size="xs" c="chatbox-tertiary" fw={700} w={16} ta="center" style={{ flexShrink: 0 }}>
                      {i + 1}
                    </Text>
                    <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                      <Text size="xs" fw={600} truncate="end">
                        {r.title}
                      </Text>
                      <Text size="xs" c="chatbox-tertiary" truncate="end">
                        {r.snippet}
                      </Text>
                    </Stack>
                    <ActionIcon variant="subtle" size="xs" color="gray" style={{ flexShrink: 0 }}>
                      <IconExternalLink size={12} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            </Box>
          </Paper>
        </Wrapper>
      </Box>
    )
  },
}

// ─── All States Overview ────────────────────────────────────────────

export const AllStatesOverview: StoryObj = {
  name: 'All States: Side-by-Side',
  render: () => (
    <Box p="lg">
      <Stack gap="xl" style={{ maxWidth: 720 }}>
        <Wrapper label="Loading States Comparison">
          <Flex gap="lg" wrap="wrap">
            {/* Current */}
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CURRENT
              </Text>
              <Paper withBorder radius="md" px="xs">
                <Group gap="xs">
                  <Text fw={600}>Web Search</Text>
                  <IconTool size={16} color="var(--chatbox-tint-success)" />
                  <IconLoader size={16} className="animate-spin" color="var(--chatbox-tint-brand)" />
                </Group>
              </Paper>
            </Stack>
            {/* Pill */}
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                PILL
              </Text>
              <Group
                gap={6}
                px={10}
                py={4}
                style={{
                  borderRadius: 'var(--mantine-radius-xl)',
                  backgroundColor: 'var(--chatbox-background-gray-secondary)',
                  display: 'inline-flex',
                }}
              >
                <IconWorld size={14} color="var(--chatbox-tint-brand)" />
                <Text size="xs" fw={500}>
                  Web Search
                </Text>
                <IconLoader size={12} className="animate-spin" color="var(--chatbox-tint-brand)" />
              </Group>
            </Stack>
            {/* Card */}
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CARD
              </Text>
              <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
                <Group px="sm" py={8} gap="xs">
                  <ThemeIcon size="sm" variant="light" color="blue" radius="xl">
                    <IconWorld size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Web Search
                  </Text>
                  <Badge
                    size="xs"
                    variant="light"
                    color="blue"
                    leftSection={<IconLoader size={10} className="animate-spin" />}
                  >
                    searching...
                  </Badge>
                </Group>
                <Progress size={2} value={65} animated color="blue" />
              </Paper>
            </Stack>
            {/* Minimal */}
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                MINIMAL
              </Text>
              <Group gap={6}>
                <Box
                  w={4}
                  h={4}
                  style={{
                    borderRadius: '50%',
                    backgroundColor: 'var(--chatbox-tint-brand)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
                <Text size="sm" c="chatbox-tertiary">
                  Searching the web...
                </Text>
              </Group>
            </Stack>
          </Flex>
        </Wrapper>

        <Wrapper label="Success States Comparison">
          <Flex gap="lg" wrap="wrap">
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CURRENT
              </Text>
              <Paper withBorder radius="md" px="xs">
                <Group gap="xs">
                  <Text fw={600}>Web Search</Text>
                  <IconTool size={16} color="var(--chatbox-tint-success)" />
                  <IconCircleCheckFilled size={16} color="var(--chatbox-tint-success)" />
                </Group>
              </Paper>
            </Stack>
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                PILL
              </Text>
              <Group
                gap={6}
                px={10}
                py={4}
                style={{
                  borderRadius: 'var(--mantine-radius-xl)',
                  backgroundColor: 'var(--chatbox-background-gray-secondary)',
                  display: 'inline-flex',
                }}
              >
                <IconWorld size={14} color="var(--chatbox-tint-success)" />
                <Text size="xs" fw={500}>
                  Web Search
                </Text>
                <IconCheck size={12} color="var(--chatbox-tint-success)" />
              </Group>
            </Stack>
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CARD
              </Text>
              <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
                <Group px="sm" py={8} gap="xs">
                  <ThemeIcon size="sm" variant="light" color="teal" radius="xl">
                    <IconWorld size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Web Search
                  </Text>
                  <Badge size="xs" variant="light" color="teal">
                    5 results
                  </Badge>
                </Group>
              </Paper>
            </Stack>
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                MINIMAL
              </Text>
              <Group gap={6}>
                <IconCheck size={14} color="var(--chatbox-tint-success)" />
                <Text
                  size="sm"
                  c="chatbox-secondary"
                  td="underline"
                  style={{ textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                >
                  Searched the web
                </Text>
                <Text size="xs" c="chatbox-tertiary">
                  · 5 results
                </Text>
              </Group>
            </Stack>
          </Flex>
        </Wrapper>

        <Wrapper label="Error States Comparison">
          <Flex gap="lg" wrap="wrap">
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CURRENT
              </Text>
              <Paper withBorder radius="md" px="xs">
                <Group gap="xs">
                  <Text fw={600}>Terminal</Text>
                  <IconTool size={16} color="var(--chatbox-tint-success)" />
                  <IconCircleXFilled size={16} color="var(--chatbox-tint-error)" />
                </Group>
              </Paper>
            </Stack>
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                PILL
              </Text>
              <Group
                gap={6}
                px={10}
                py={4}
                style={{
                  borderRadius: 'var(--mantine-radius-xl)',
                  backgroundColor: 'color-mix(in srgb, var(--chatbox-tint-error) 8%, transparent)',
                  display: 'inline-flex',
                }}
              >
                <IconTerminal size={14} color="var(--chatbox-tint-error)" />
                <Text size="xs" fw={500} c="chatbox-error">
                  Terminal
                </Text>
                <IconCircleXFilled size={12} color="var(--chatbox-tint-error)" />
              </Group>
            </Stack>
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CARD
              </Text>
              <Paper
                withBorder
                radius="md"
                p={0}
                style={{ overflow: 'hidden', borderColor: 'var(--chatbox-border-error)' }}
              >
                <Group px="sm" py={8} gap="xs">
                  <ThemeIcon size="sm" variant="light" color="red" radius="xl">
                    <IconTerminal size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Terminal
                  </Text>
                  <Badge size="xs" variant="light" color="red">
                    failed
                  </Badge>
                </Group>
              </Paper>
            </Stack>
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                MINIMAL
              </Text>
              <Group gap={6}>
                <IconCircleXFilled size={14} color="var(--chatbox-tint-error)" />
                <Text size="sm" c="chatbox-error">
                  Terminal command failed
                </Text>
              </Group>
            </Stack>
          </Flex>
        </Wrapper>
      </Stack>
    </Box>
  ),
}

// ─── Reasoning / Thinking UI ────────────────────────────────────────

const SAMPLE_REASONING = `The user is asking about React Server Components vs client-side rendering. Let me break this down:

1. Server Components render on the server, reducing client bundle size
2. They can directly access server resources (databases, file system)
3. Client Components are needed for interactivity (useState, useEffect, event handlers)
4. The key decision factor is whether the component needs browser APIs or user interaction

I should explain the trade-offs clearly and provide practical guidance on when to choose each approach.`

export const CurrentThinking: StoryObj = {
  name: 'Current: Thinking/Reasoning',
  render: () => {
    const [thinkingExpanded, setThinkingExpanded] = useState(false)
    const [activeExpanded, setActiveExpanded] = useState(false)
    return (
      <Wrapper
        label="Current Design"
        description="Bordered Paper with bulb icon, animate-pulse when active, copy button, chevron to expand"
      >
        <Stack gap="sm">
          {/* Active thinking */}
          <Paper withBorder radius="md">
            <Box onClick={() => setActiveExpanded(!activeExpanded)} className="cursor-pointer">
              <Group px="xs" justify="space-between" className="w-full">
                <Group gap="xs" className="animate-pulse">
                  <IconBulb size={16} color="var(--chatbox-tint-warning)" />
                  <Text fw={600} size="sm">
                    Thinking
                  </Text>
                  <Text size="xs" c="chatbox-tertiary">
                    (3.2s)
                  </Text>
                </Group>
                <Space miw="xl" />
                <Group gap="xs">
                  <ActionIcon variant="subtle" c="chatbox-gray" size="sm">
                    <IconCopy size={16} />
                  </ActionIcon>
                  <IconChevronRight
                    size={16}
                    className={clsx('transition-transform', activeExpanded ? 'rotate-90' : '')}
                  />
                </Group>
              </Group>
            </Box>
            <Collapse in={activeExpanded}>
              <Box style={{ borderTop: '1px solid var(--paper-border-color)' }}>
                <Text size="sm" px="sm" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                  {SAMPLE_REASONING}
                </Text>
              </Box>
            </Collapse>
          </Paper>

          {/* Completed thinking */}
          <Paper withBorder radius="md">
            <Box onClick={() => setThinkingExpanded(!thinkingExpanded)} className="cursor-pointer">
              <Group px="xs" justify="space-between" className="w-full">
                <Group gap="xs">
                  <IconBulb size={16} color="var(--chatbox-tint-warning)" />
                  <Text fw={600} size="sm">
                    Deeply thought
                  </Text>
                  <Text size="xs" c="chatbox-tertiary">
                    (12.4s)
                  </Text>
                </Group>
                <Space miw="xl" />
                <Group gap="xs">
                  <ActionIcon variant="subtle" c="chatbox-gray" size="sm">
                    <IconCopy size={16} />
                  </ActionIcon>
                  <IconChevronRight
                    size={16}
                    className={clsx('transition-transform', thinkingExpanded ? 'rotate-90' : '')}
                  />
                </Group>
              </Group>
            </Box>
            <Collapse in={thinkingExpanded}>
              <Box style={{ borderTop: '1px solid var(--paper-border-color)' }}>
                <Text size="sm" px="sm" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                  {SAMPLE_REASONING}
                </Text>
              </Box>
            </Collapse>
          </Paper>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Option A: Gradient Accent Bar ──────────────────────────────────

export const ThinkingOptionA_GradientBar: StoryObj = {
  name: 'Thinking A: Gradient Accent Bar',
  render: () => {
    const [expanded, setExpanded] = useState(true)
    const [activeExpanded, setActiveExpanded] = useState(false)
    return (
      <Wrapper
        label="Option A: Gradient Accent Bar"
        description="Left border gradient (amber→orange) as visual signature for thinking blocks. Lighter background to distinguish from tool calls."
      >
        <Stack gap="sm">
          {/* Active thinking */}
          <Paper
            radius="md"
            p={0}
            style={{
              overflow: 'hidden',
              backgroundColor:
                'color-mix(in srgb, var(--chatbox-tint-warning) 6%, var(--chatbox-background-secondary))',
              borderLeft: '3px solid',
              borderImage: 'linear-gradient(180deg, #f59e0b, #f97316) 1',
            }}
          >
            <UnstyledButton w="100%" onClick={() => setActiveExpanded(!activeExpanded)}>
              <Group px="sm" py={8} justify="space-between">
                <Group gap="xs">
                  <IconSparkles size={14} color="#f59e0b" className="animate-pulse" />
                  <Text size="sm" fw={600}>
                    Thinking
                  </Text>
                  <Text size="xs" c="chatbox-tertiary" ff="monospace">
                    3.2s
                  </Text>
                </Group>
                <Group gap={4}>
                  <ActionIcon variant="subtle" size="xs" color="gray" onClick={(e) => e.stopPropagation()}>
                    <IconCopy size={12} />
                  </ActionIcon>
                  <IconChevronRight
                    size={14}
                    color="var(--chatbox-tertiary)"
                    className={clsx('transition-transform', activeExpanded ? 'rotate-90' : '')}
                  />
                </Group>
              </Group>
            </UnstyledButton>
            <Collapse in={activeExpanded}>
              <Box
                px="sm"
                pb="sm"
                style={{ borderTop: '1px solid color-mix(in srgb, var(--chatbox-tint-warning) 15%, transparent)' }}
              >
                <Text size="sm" style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }} c="chatbox-secondary" mt="xs">
                  {SAMPLE_REASONING}
                </Text>
              </Box>
            </Collapse>
          </Paper>

          {/* Completed - expanded */}
          <Paper
            radius="md"
            p={0}
            style={{
              overflow: 'hidden',
              backgroundColor:
                'color-mix(in srgb, var(--chatbox-tint-warning) 4%, var(--chatbox-background-secondary))',
              borderLeft: '3px solid',
              borderImage: 'linear-gradient(180deg, #f59e0b, #f97316) 1',
            }}
          >
            <UnstyledButton w="100%" onClick={() => setExpanded(!expanded)}>
              <Group px="sm" py={8} justify="space-between">
                <Group gap="xs">
                  <IconBulb size={14} color="#f59e0b" />
                  <Text size="sm" fw={600}>
                    Thought for 12.4s
                  </Text>
                </Group>
                <Group gap={4}>
                  <ActionIcon variant="subtle" size="xs" color="gray" onClick={(e) => e.stopPropagation()}>
                    <IconCopy size={12} />
                  </ActionIcon>
                  <IconChevronRight
                    size={14}
                    color="var(--chatbox-tertiary)"
                    className={clsx('transition-transform', expanded ? 'rotate-90' : '')}
                  />
                </Group>
              </Group>
            </UnstyledButton>
            <Collapse in={expanded}>
              <Box
                px="sm"
                pb="sm"
                style={{ borderTop: '1px solid color-mix(in srgb, var(--chatbox-tint-warning) 15%, transparent)' }}
              >
                <Text size="sm" style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }} c="chatbox-secondary" mt="xs">
                  {SAMPLE_REASONING}
                </Text>
              </Box>
            </Collapse>
          </Paper>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Option B: Pill + Inline Expand ─────────────────────────────────

export const ThinkingOptionB_Pill: StoryObj = {
  name: 'Thinking B: Compact Pill',
  render: () => {
    const [expanded, setExpanded] = useState<string | null>('done')
    return (
      <Wrapper
        label="Option B: Compact Pill"
        description="Thinking displayed as a compact pill matching the tool call pill style. Clicking reveals content below. Extremely low visual weight when collapsed."
      >
        <Stack gap={8}>
          {/* Active thinking pill */}
          <UnstyledButton>
            <Group
              gap={6}
              px={10}
              py={4}
              style={{
                borderRadius: 'var(--mantine-radius-xl)',
                background:
                  'linear-gradient(135deg, color-mix(in srgb, #f59e0b 10%, transparent), color-mix(in srgb, #f97316 8%, transparent))',
                display: 'inline-flex',
              }}
            >
              <IconSparkles size={13} color="#f59e0b" className="animate-pulse" />
              <Text size="xs" fw={500}>
                Thinking
              </Text>
              <Text size="xs" c="chatbox-tertiary" ff="monospace">
                3.2s
              </Text>
              <IconLoader size={11} className="animate-spin" color="#f59e0b" />
            </Group>
          </UnstyledButton>

          {/* Completed thinking pill - collapsed */}
          <UnstyledButton onClick={() => setExpanded(expanded === 'short' ? null : 'short')}>
            <Group
              gap={6}
              px={10}
              py={4}
              style={{
                borderRadius: 'var(--mantine-radius-xl)',
                backgroundColor: 'var(--chatbox-background-gray-secondary)',
                display: 'inline-flex',
              }}
            >
              <IconBulb size={13} color="#f59e0b" />
              <Text size="xs" fw={500}>
                Thought for 2.1s
              </Text>
              <IconChevronDown
                size={12}
                color="var(--chatbox-tertiary)"
                className={clsx('transition-transform', expanded === 'short' ? 'rotate-180' : '')}
              />
            </Group>
          </UnstyledButton>
          <Collapse in={expanded === 'short'}>
            <Box ml={4} pl="sm" style={{ borderLeft: '2px solid #f59e0b' }}>
              <Text size="sm" c="chatbox-secondary" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                The user wants to know about React Server Components. This is a straightforward comparison question.
              </Text>
              <Group gap={4} mt={4}>
                <ActionIcon variant="subtle" size="xs" color="gray">
                  <IconCopy size={12} />
                </ActionIcon>
              </Group>
            </Box>
          </Collapse>

          {/* Completed thinking pill - expanded long */}
          <UnstyledButton onClick={() => setExpanded(expanded === 'done' ? null : 'done')}>
            <Group
              gap={6}
              px={10}
              py={4}
              style={{
                borderRadius: 'var(--mantine-radius-xl)',
                backgroundColor: 'var(--chatbox-background-gray-secondary)',
                display: 'inline-flex',
              }}
            >
              <IconBulb size={13} color="#f59e0b" />
              <Text size="xs" fw={500}>
                Thought for 12.4s
              </Text>
              <IconChevronDown
                size={12}
                color="var(--chatbox-tertiary)"
                className={clsx('transition-transform', expanded === 'done' ? 'rotate-180' : '')}
              />
            </Group>
          </UnstyledButton>
          <Collapse in={expanded === 'done'}>
            <Box ml={4} pl="sm" style={{ borderLeft: '2px solid #f59e0b' }}>
              <Text size="sm" c="chatbox-secondary" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                {SAMPLE_REASONING}
              </Text>
              <Group gap={4} mt={4}>
                <ActionIcon variant="subtle" size="xs" color="gray">
                  <IconCopy size={12} />
                </ActionIcon>
              </Group>
            </Box>
          </Collapse>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Option C: Card with Brain Icon ─────────────────────────────────

export const ThinkingOptionC_BrainCard: StoryObj = {
  name: 'Thinking C: Brain Card',
  render: () => {
    const [expanded, setExpanded] = useState(true)
    const [activeExpanded, setActiveExpanded] = useState(false)
    return (
      <Wrapper
        label="Option C: Brain Card"
        description="Structured card matching Option B tool call style. Uses ThemeIcon with brain/sparkle icon, status badge, and progress bar for active thinking."
      >
        <Stack gap="sm">
          {/* Active thinking */}
          <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <UnstyledButton w="100%" onClick={() => setActiveExpanded(!activeExpanded)}>
              <Group px="sm" py={8} justify="space-between">
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="yellow" radius="xl">
                    <IconSparkles size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Thinking
                  </Text>
                  <Badge
                    size="xs"
                    variant="light"
                    color="yellow"
                    leftSection={<IconLoader size={10} className="animate-spin" />}
                  >
                    3.2s
                  </Badge>
                </Group>
                <Group gap={4}>
                  <ActionIcon variant="subtle" size="xs" color="gray" onClick={(e) => e.stopPropagation()}>
                    <IconCopy size={12} />
                  </ActionIcon>
                  <IconChevronRight
                    size={14}
                    color="var(--chatbox-tertiary)"
                    className={clsx('transition-transform', activeExpanded ? 'rotate-90' : '')}
                  />
                </Group>
              </Group>
            </UnstyledButton>
            <Progress size={2} value={100} animated color="yellow" />
          </Paper>

          {/* Completed - collapsed */}
          <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <Group px="sm" py={8} justify="space-between" className="cursor-pointer">
              <Group gap="xs">
                <ThemeIcon size="sm" variant="light" color="yellow" radius="xl">
                  <IconBrain size={12} />
                </ThemeIcon>
                <Text size="sm" fw={600}>
                  Deeply thought
                </Text>
                <Badge size="xs" variant="light" color="gray">
                  12.4s
                </Badge>
              </Group>
              <Group gap={4}>
                <ActionIcon variant="subtle" size="xs" color="gray">
                  <IconCopy size={12} />
                </ActionIcon>
                <IconChevronRight size={14} color="var(--chatbox-tertiary)" />
              </Group>
            </Group>
          </Paper>

          {/* Completed - expanded */}
          <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
            <UnstyledButton w="100%" onClick={() => setExpanded(!expanded)}>
              <Group px="sm" py={8} justify="space-between">
                <Group gap="xs">
                  <ThemeIcon size="sm" variant="light" color="yellow" radius="xl">
                    <IconBrain size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Deeply thought
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    12.4s
                  </Badge>
                </Group>
                <Group gap={4}>
                  <ActionIcon variant="subtle" size="xs" color="gray" onClick={(e) => e.stopPropagation()}>
                    <IconCopy size={12} />
                  </ActionIcon>
                  <IconChevronRight
                    size={14}
                    color="var(--chatbox-tertiary)"
                    className={clsx('transition-transform', expanded ? 'rotate-90' : '')}
                  />
                </Group>
              </Group>
            </UnstyledButton>
            <Collapse in={expanded}>
              <Box px="sm" pb="sm" style={{ borderTop: '1px solid var(--paper-border-color)' }}>
                <Text size="sm" c="chatbox-secondary" style={{ whiteSpace: 'pre-line', lineHeight: 1.6 }} mt="xs">
                  {SAMPLE_REASONING}
                </Text>
              </Box>
            </Collapse>
          </Paper>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Option D: Minimal Inline Thinking ──────────────────────────────

export const ThinkingOptionD_MinimalInline: StoryObj = {
  name: 'Thinking D: Minimal Inline',
  render: () => {
    const [expanded, setExpanded] = useState<string | null>('done')
    return (
      <Wrapper
        label="Option D: Minimal Inline"
        description="Ultra-minimal text-only style matching Claude.ai. Thinking is just an italic line with dotted underline, expandable."
      >
        <Stack gap={8}>
          {/* Active thinking */}
          <Group gap={6}>
            <Box
              w={4}
              h={4}
              style={{
                borderRadius: '50%',
                backgroundColor: '#f59e0b',
                animation: 'pulse 1.5s ease-in-out infinite',
              }}
            />
            <Text size="sm" c="chatbox-tertiary" fs="italic">
              Thinking...
            </Text>
            <Text size="xs" c="chatbox-tertiary" ff="monospace">
              3.2s
            </Text>
          </Group>

          {/* Completed - collapsed */}
          <UnstyledButton onClick={() => setExpanded(expanded === 'short' ? null : 'short')}>
            <Group gap={6}>
              <IconBulb size={14} color="#f59e0b" />
              <Text
                size="sm"
                c="chatbox-secondary"
                td="underline"
                style={{ textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
              >
                Thought for 2.1s
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse in={expanded === 'short'}>
            <Text size="sm" c="chatbox-tertiary" ml={20} style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
              The user wants to know about RSC. Straightforward comparison.
            </Text>
          </Collapse>

          {/* Completed - expanded */}
          <UnstyledButton onClick={() => setExpanded(expanded === 'done' ? null : 'done')}>
            <Group gap={6}>
              <IconBulb size={14} color="#f59e0b" />
              <Text
                size="sm"
                c="chatbox-secondary"
                td="underline"
                style={{ textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
              >
                Thought for 12.4s
              </Text>
              <ActionIcon variant="subtle" size="xs" color="gray" onClick={(e) => e.stopPropagation()}>
                <IconCopy size={12} />
              </ActionIcon>
            </Group>
          </UnstyledButton>
          <Collapse in={expanded === 'done'}>
            <Text size="sm" c="chatbox-tertiary" ml={20} style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
              {SAMPLE_REASONING}
            </Text>
          </Collapse>
        </Stack>
      </Wrapper>
    )
  },
}

// ─── Thinking States Side-by-Side ───────────────────────────────────

export const ThinkingStatesOverview: StoryObj = {
  name: 'Thinking: All States Side-by-Side',
  render: () => (
    <Box p="lg">
      <Stack gap="xl" style={{ maxWidth: 800 }}>
        <Wrapper label="Active Thinking States">
          <Flex gap="lg" wrap="wrap">
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CURRENT
              </Text>
              <Paper withBorder radius="md">
                <Group px="xs" gap="xs" className="animate-pulse">
                  <IconBulb size={16} color="var(--chatbox-tint-warning)" />
                  <Text fw={600} size="sm">
                    Thinking
                  </Text>
                  <Text size="xs" c="chatbox-tertiary">
                    (3.2s)
                  </Text>
                  <Space style={{ flex: 1 }} />
                  <ActionIcon variant="subtle" c="chatbox-gray" size="sm">
                    <IconCopy size={16} />
                  </ActionIcon>
                  <IconChevronRight size={16} />
                </Group>
              </Paper>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                GRADIENT BAR
              </Text>
              <Paper
                radius="md"
                px="sm"
                py={8}
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--chatbox-tint-warning) 6%, var(--chatbox-background-secondary))',
                  borderLeft: '3px solid',
                  borderImage: 'linear-gradient(180deg, #f59e0b, #f97316) 1',
                }}
              >
                <Group gap="xs">
                  <IconSparkles size={14} color="#f59e0b" className="animate-pulse" />
                  <Text size="sm" fw={600}>
                    Thinking
                  </Text>
                  <Text size="xs" c="chatbox-tertiary" ff="monospace">
                    3.2s
                  </Text>
                </Group>
              </Paper>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                PILL
              </Text>
              <Box>
                <Group
                  gap={6}
                  px={10}
                  py={4}
                  style={{
                    borderRadius: 'var(--mantine-radius-xl)',
                    background:
                      'linear-gradient(135deg, color-mix(in srgb, #f59e0b 10%, transparent), color-mix(in srgb, #f97316 8%, transparent))',
                    display: 'inline-flex',
                  }}
                >
                  <IconSparkles size={13} color="#f59e0b" className="animate-pulse" />
                  <Text size="xs" fw={500}>
                    Thinking
                  </Text>
                  <Text size="xs" c="chatbox-tertiary" ff="monospace">
                    3.2s
                  </Text>
                  <IconLoader size={11} className="animate-spin" color="#f59e0b" />
                </Group>
              </Box>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CARD
              </Text>
              <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
                <Group px="sm" py={8} gap="xs">
                  <ThemeIcon size="sm" variant="light" color="yellow" radius="xl">
                    <IconSparkles size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Thinking
                  </Text>
                  <Badge
                    size="xs"
                    variant="light"
                    color="yellow"
                    leftSection={<IconLoader size={10} className="animate-spin" />}
                  >
                    3.2s
                  </Badge>
                </Group>
                <Progress size={2} value={100} animated color="yellow" />
              </Paper>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                MINIMAL
              </Text>
              <Group gap={6}>
                <Box
                  w={4}
                  h={4}
                  style={{
                    borderRadius: '50%',
                    backgroundColor: '#f59e0b',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
                <Text size="sm" c="chatbox-tertiary" fs="italic">
                  Thinking...
                </Text>
                <Text size="xs" c="chatbox-tertiary" ff="monospace">
                  3.2s
                </Text>
              </Group>
            </Stack>
          </Flex>
        </Wrapper>

        <Wrapper label="Completed Thinking States (collapsed)">
          <Flex gap="lg" wrap="wrap">
            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CURRENT
              </Text>
              <Paper withBorder radius="md">
                <Group px="xs" gap="xs">
                  <IconBulb size={16} color="var(--chatbox-tint-warning)" />
                  <Text fw={600} size="sm">
                    Deeply thought
                  </Text>
                  <Text size="xs" c="chatbox-tertiary">
                    (12.4s)
                  </Text>
                  <Space style={{ flex: 1 }} />
                  <ActionIcon variant="subtle" c="chatbox-gray" size="sm">
                    <IconCopy size={16} />
                  </ActionIcon>
                  <IconChevronRight size={16} />
                </Group>
              </Paper>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                GRADIENT BAR
              </Text>
              <Paper
                radius="md"
                px="sm"
                py={8}
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--chatbox-tint-warning) 4%, var(--chatbox-background-secondary))',
                  borderLeft: '3px solid',
                  borderImage: 'linear-gradient(180deg, #f59e0b, #f97316) 1',
                }}
              >
                <Group gap="xs">
                  <IconBulb size={14} color="#f59e0b" />
                  <Text size="sm" fw={600}>
                    Thought for 12.4s
                  </Text>
                </Group>
              </Paper>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                PILL
              </Text>
              <Box>
                <Group
                  gap={6}
                  px={10}
                  py={4}
                  style={{
                    borderRadius: 'var(--mantine-radius-xl)',
                    backgroundColor: 'var(--chatbox-background-gray-secondary)',
                    display: 'inline-flex',
                  }}
                >
                  <IconBulb size={13} color="#f59e0b" />
                  <Text size="xs" fw={500}>
                    Thought for 12.4s
                  </Text>
                  <IconChevronDown size={12} color="var(--chatbox-tertiary)" />
                </Group>
              </Box>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                CARD
              </Text>
              <Paper withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
                <Group px="sm" py={8} gap="xs">
                  <ThemeIcon size="sm" variant="light" color="yellow" radius="xl">
                    <IconBrain size={12} />
                  </ThemeIcon>
                  <Text size="sm" fw={600}>
                    Deeply thought
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    12.4s
                  </Badge>
                </Group>
              </Paper>
            </Stack>

            <Stack gap={4} style={{ flex: '1 1 300px' }}>
              <Text size="xs" c="dimmed" fw={600}>
                MINIMAL
              </Text>
              <Group gap={6}>
                <IconBulb size={14} color="#f59e0b" />
                <Text
                  size="sm"
                  c="chatbox-secondary"
                  td="underline"
                  style={{ textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}
                >
                  Thought for 12.4s
                </Text>
              </Group>
            </Stack>
          </Flex>
        </Wrapper>
      </Stack>
    </Box>
  ),
}
