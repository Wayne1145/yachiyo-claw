import { ActionIcon, Avatar, Box, Flex, Stack, Text, Title } from '@mantine/core'
import { IconCopy, IconDotsVertical, IconPencil, IconReload, IconRobot, IconUser } from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

const meta: Meta = {
  title: 'Chat/Message Bubble',
  parameters: {
    docs: {
      description: {
        component: `
## Message Bubble Component Analysis

The current Message component (\`Message.tsx\`) is 810+ lines, mixing layout, logic, and interactions.

### Current Issues

1. **Mixed UI Libraries**: Uses both MUI (\`Grid\`, \`Box\`, \`Typography\`) and Mantine simultaneously,
   increasing bundle size and creating inconsistent styling.
2. **Component Size**: Single file handles avatars, content rendering, action buttons, image gallery,
   tool calls, reasoning content, and error tips.
3. **Fixed Avatar + Content Layout**: Uses MUI Grid with hardcoded spacing; not responsive-friendly.
4. **Action Buttons Visibility**: Hover-to-reveal pattern works on desktop but requires separate handling on mobile.

### Optimization Suggestions

1. **Remove MUI dependency from Message**: Replace \`Grid\`/\`Box\` with Mantine's \`Flex\`/\`Box\` or pure Tailwind
   for a 30-40% reduction in component-specific bundle size.
2. **Extract Sub-components**: Split into \`MessageAvatar\`, \`MessageContent\`, \`MessageActions\`, \`MessageMeta\`
   for better maintainability and isolated testing.
3. **Unified Bubble Styling**: Standardize padding, border-radius and backgrounds using design tokens
   instead of mixing inline styles and Tailwind classes.
4. **Improve Action Bar**: Use a floating toolbar with consistent positioning instead of inline flex
   with hover opacity toggles. Consider a "swipe to reveal" pattern on mobile.
5. **Better Meta Display**: Move token/word counts into a collapsible footer instead of inline text
   to reduce visual noise.
        `,
      },
    },
  },
}

export default meta

const UserAvatar = () => (
  <Avatar radius="xl" size={36} color="blue">
    <IconUser size={20} />
  </Avatar>
)

const AssistantAvatar = () => (
  <Avatar radius="xl" size={36} color="teal">
    <IconRobot size={20} />
  </Avatar>
)

const ActionBar = ({ visible = true }: { visible?: boolean }) => (
  <Flex gap={0} style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.15s' }}>
    {[
      { icon: IconReload, label: 'Regenerate' },
      { icon: IconPencil, label: 'Edit' },
      { icon: IconCopy, label: 'Copy' },
      { icon: IconDotsVertical, label: 'More' },
    ].map(({ icon: Icon, label }) => (
      <ActionIcon key={label} variant="subtle" size="sm" color="gray" p={4}>
        <Icon size={14} />
      </ActionIcon>
    ))}
  </Flex>
)

const MessageWrapper = ({
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
      <Text fw={600} size="sm">
        {label}
      </Text>
      {description && (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      )}
    </Box>
    <Box style={{ maxWidth: 720 }}>{children}</Box>
  </Stack>
)

export const CurrentUserMessage: StoryObj = {
  name: 'Current: User Message',
  render: () => (
    <MessageWrapper
      label="Current User Message Style"
      description="Uses bg-chatbox-background-secondary with rounded-lg"
    >
      <Flex gap="sm" px="md" py="xs" className="w-full">
        <Box className="mt-1 flex-shrink-0">
          <UserAvatar />
        </Box>
        <Stack gap={4} className="flex-1 min-w-0">
          <Box className="inline-block bg-chatbox-background-secondary px-4 py-2 rounded-lg max-w-full">
            <Text size="sm">
              Can you explain the difference between React Server Components and traditional client-side rendering? I'd
              like to understand when to use each approach.
            </Text>
          </Box>
          <ActionBar />
        </Stack>
      </Flex>
    </MessageWrapper>
  ),
}

export const CurrentAssistantMessage: StoryObj = {
  name: 'Current: Assistant Message',
  render: () => (
    <MessageWrapper label="Current Assistant Message Style" description="Full-width content without background box">
      <Flex gap="sm" px="md" py="xs" className="w-full">
        <Box className="mt-2 flex-shrink-0">
          <AssistantAvatar />
        </Box>
        <Stack gap={4} className="flex-1 min-w-0 w-full">
          <Text size="sm">React Server Components (RSC) and client-side rendering serve different purposes:</Text>
          <Text size="sm" mt={4}>
            <strong>Server Components</strong> run on the server and can directly access databases, file systems, and
            other server resources. They send only the rendered HTML to the client, reducing JavaScript bundle size.
          </Text>
          <Text size="sm" mt={4}>
            <strong>Client Components</strong> run in the browser and are needed for interactivity — event handlers,
            state management, and browser APIs.
          </Text>
          <Text size="xs" c="chatbox-tertiary" mt="xs">
            model: gpt-4o, tokens used: 156
          </Text>
          <ActionBar />
        </Stack>
      </Flex>
    </MessageWrapper>
  ),
}

export const OptimizedUserMessage: StoryObj = {
  name: 'Optimized: User Bubble',
  render: () => (
    <MessageWrapper
      label="Optimized User Message"
      description="Right-aligned bubble with brand accent, no avatar needed for self"
    >
      <Flex justify="flex-end" px="md" py="xs">
        <Box
          className="inline-block px-4 py-3 rounded-2xl rounded-tr-sm max-w-[85%]"
          style={{
            backgroundColor: 'var(--chatbox-background-brand-secondary)',
            border: '1px solid var(--chatbox-border-brand)',
          }}
        >
          <Text size="sm" c="chatbox-primary">
            Can you explain the difference between React Server Components and traditional client-side rendering?
          </Text>
        </Box>
      </Flex>
    </MessageWrapper>
  ),
}

export const OptimizedAssistantMessage: StoryObj = {
  name: 'Optimized: Assistant Bubble',
  render: () => (
    <MessageWrapper
      label="Optimized Assistant Message"
      description="Clean left-aligned layout with subtle background and structured meta"
    >
      <Flex gap="sm" px="md" py="sm" className="group">
        <Box className="mt-1 flex-shrink-0">
          <AssistantAvatar />
        </Box>
        <Stack gap="xs" className="flex-1 min-w-0">
          <Box
            className="px-4 py-3 rounded-2xl rounded-tl-sm"
            style={{
              backgroundColor: 'var(--chatbox-background-secondary)',
            }}
          >
            <Text size="sm">React Server Components (RSC) and client-side rendering serve different purposes:</Text>
            <Text size="sm" mt="sm">
              <strong>Server Components</strong> run on the server and can directly access databases. They reduce bundle
              size by sending only rendered HTML.
            </Text>
            <Text size="sm" mt="sm">
              <strong>Client Components</strong> run in the browser for interactivity.
            </Text>
          </Box>

          <Flex align="center" justify="space-between">
            <Flex gap={4} align="center">
              <Text size="xs" c="chatbox-tertiary" ff="monospace">
                gpt-4o
              </Text>
              <Text size="xs" c="chatbox-tertiary">
                ·
              </Text>
              <Text size="xs" c="chatbox-tertiary">
                156 tokens
              </Text>
              <Text size="xs" c="chatbox-tertiary">
                ·
              </Text>
              <Text size="xs" c="chatbox-tertiary">
                1.2s
              </Text>
            </Flex>
            <ActionBar />
          </Flex>
        </Stack>
      </Flex>
    </MessageWrapper>
  ),
}

export const CompactLayout: StoryObj = {
  name: 'Optimized: Compact Dense Layout',
  render: () => (
    <MessageWrapper
      label="Compact Layout for Power Users"
      description="Smaller avatars, tighter spacing, more content visible at once"
    >
      <Stack gap={2} style={{ maxWidth: 720 }}>
        <Flex gap="xs" px="sm" py={4}>
          <Avatar size={24} color="blue" radius="xl">
            <IconUser size={14} />
          </Avatar>
          <Box className="bg-chatbox-background-secondary px-3 py-1.5 rounded-lg">
            <Text size="xs">What is the capital of France?</Text>
          </Box>
        </Flex>
        <Flex gap="xs" px="sm" py={4}>
          <Avatar size={24} color="teal" radius="xl">
            <IconRobot size={14} />
          </Avatar>
          <Stack gap={2} className="flex-1">
            <Text size="xs">The capital of France is Paris.</Text>
            <Text size="10px" c="chatbox-tertiary" ff="monospace">
              gpt-4o · 8 tokens · 0.3s
            </Text>
          </Stack>
        </Flex>
        <Flex gap="xs" px="sm" py={4}>
          <Avatar size={24} color="blue" radius="xl">
            <IconUser size={14} />
          </Avatar>
          <Box className="bg-chatbox-background-secondary px-3 py-1.5 rounded-lg">
            <Text size="xs">And what's its population?</Text>
          </Box>
        </Flex>
        <Flex gap="xs" px="sm" py={4}>
          <Avatar size={24} color="teal" radius="xl">
            <IconRobot size={14} />
          </Avatar>
          <Stack gap={2} className="flex-1">
            <Text size="xs">
              Paris has about 2.1 million residents in the city proper, and roughly 12 million in the metropolitan area.
            </Text>
            <Text size="10px" c="chatbox-tertiary" ff="monospace">
              gpt-4o · 28 tokens · 0.5s
            </Text>
          </Stack>
        </Flex>
      </Stack>
    </MessageWrapper>
  ),
}

export const MessageStates: StoryObj = {
  name: 'Message States',
  render: () => (
    <Box p="lg" style={{ maxWidth: 720 }}>
      <Title order={3} mb="lg">
        Message States
      </Title>

      <MessageWrapper label="Loading / Generating" description="Typing indicator while AI generates">
        <Flex gap="sm" px="md" py="sm">
          <AssistantAvatar />
          <Box
            className="px-4 py-3 rounded-2xl rounded-tl-sm"
            style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
          >
            <Flex gap="xs" align="center">
              <Box
                w={6}
                h={6}
                style={{
                  borderRadius: '50%',
                  backgroundColor: 'var(--chatbox-tint-tertiary)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
              <Box
                w={6}
                h={6}
                style={{
                  borderRadius: '50%',
                  backgroundColor: 'var(--chatbox-tint-tertiary)',
                  animation: 'pulse 1.5s ease-in-out 0.3s infinite',
                }}
              />
              <Box
                w={6}
                h={6}
                style={{
                  borderRadius: '50%',
                  backgroundColor: 'var(--chatbox-tint-tertiary)',
                  animation: 'pulse 1.5s ease-in-out 0.6s infinite',
                }}
              />
            </Flex>
          </Box>
        </Flex>
      </MessageWrapper>

      <MessageWrapper label="Error State" description="When API call fails">
        <Flex gap="sm" px="md" py="sm">
          <AssistantAvatar />
          <Box
            className="px-4 py-3 rounded-2xl rounded-tl-sm"
            style={{
              backgroundColor: 'var(--chatbox-background-error-secondary)',
              border: '1px solid var(--chatbox-border-error)',
            }}
          >
            <Text size="sm" c="chatbox-error">
              Failed to generate response. Please check your API key and try again.
            </Text>
            <Flex mt="xs" gap="xs">
              <ActionIcon variant="light" size="sm" color="red">
                <IconReload size={14} />
              </ActionIcon>
              <Text size="xs" c="chatbox-tertiary" className="self-center">
                Retry
              </Text>
            </Flex>
          </Box>
        </Flex>
      </MessageWrapper>

      <MessageWrapper label="Collapsed Long Message" description="For messages exceeding threshold">
        <Flex gap="sm" px="md" py="sm">
          <AssistantAvatar />
          <Stack gap="xs" className="flex-1">
            <Box
              className="px-4 py-3 rounded-2xl rounded-tl-sm"
              style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
            >
              <Text size="sm" lineClamp={3}>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et
                dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip
                ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
                fugiat nulla pariatur...
              </Text>
              <Text size="xs" c="blue" fw={600} mt="xs" className="cursor-pointer hover:underline">
                [Expand]
              </Text>
            </Box>
          </Stack>
        </Flex>
      </MessageWrapper>
    </Box>
  ),
}
