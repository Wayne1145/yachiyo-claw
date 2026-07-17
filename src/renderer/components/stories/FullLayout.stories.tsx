import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconArrowUp,
  IconCirclePlus,
  IconCopy,
  IconDots,
  IconDotsVertical,
  IconFilePencil,
  IconHelpCircle,
  IconHistory,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconMessageChatbot,
  IconPencil,
  IconReload,
  IconRobot,
  IconSearch,
  IconSettingsFilled,
  IconStarFilled,
  IconUser,
  IconVocabulary,
  IconWorldWww,
} from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

const meta: Meta = {
  title: 'Layout/Full Page Composition',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## Full Page Composition

Shows how all components come together as a complete chat interface.

### Architecture Observations

1. **MUI + Mantine Mixing**: The root layout uses both MUI Grid and Mantine components.
   This doubles the CSS-in-JS runtime and increases bundle size significantly.
2. **Fixed Layout Model**: The sidebar uses MUI SwipeableDrawer with fixed width.
   A CSS Grid-based layout with \`grid-template-columns\` would be more performant.
3. **Scroll Container Management**: MessageList uses \`react-virtuoso\` inside a flex container.
   The scroll boundaries and overflow handling need careful management.

### Key Optimization Recommendations

1. **Eliminate MUI completely**: Replace all MUI components with Mantine equivalents.
   This alone could reduce JS bundle by ~100KB and remove CSS-in-JS overhead.
2. **CSS Grid Layout**: Use CSS Grid for the main layout instead of nested flex containers.
   \`grid-template-columns: auto 1fr\` for sidebar + content.
3. **Smooth Transitions**: Add layout animations when sidebar opens/closes using CSS transitions
   instead of MUI's JavaScript-based slide animation.
4. **Focus Management**: Implement proper focus management between sidebar and main content
   for keyboard navigation support.
        `,
      },
    },
  },
}

export default meta

const SessionItem = ({ name, selected, starred }: { name: string; selected: boolean; starred?: boolean }) => (
  <Flex
    align="center"
    className={`cursor-pointer rounded-md ${selected ? 'bg-chatbox-background-brand-secondary' : 'hover:bg-chatbox-background-gray-secondary'}`}
    mx="xs"
    px="xs"
    py={8}
    gap={8}
  >
    <Avatar size={28} color={selected ? 'blue' : 'gray'} radius="md" variant="light">
      <IconRobot size={14} />
    </Avatar>
    <Text size="sm" flex={1} lineClamp={1} c={selected ? 'chatbox-brand' : 'chatbox-primary'}>
      {name}
    </Text>
    {starred && <IconStarFilled size={12} color="var(--chatbox-tint-brand)" />}
  </Flex>
)

const ActionBar = () => (
  <Flex gap={0}>
    {[IconReload, IconPencil, IconCopy, IconDotsVertical].map((Icon, i) => (
      <ActionIcon key={i} variant="subtle" size="sm" color="gray" p={4}>
        <Icon size={14} />
      </ActionIcon>
    ))}
  </Flex>
)

export const CurrentLayout: StoryObj = {
  name: 'Current Full Layout',
  render: () => (
    <Flex style={{ height: '100vh', width: '100%', backgroundColor: 'var(--chatbox-background-primary)' }}>
      {/* Sidebar */}
      <Box w={280} className="flex-shrink-0" style={{ borderRight: '1px solid var(--chatbox-border-primary)' }}>
        <Stack h="100%" gap={0}>
          <Flex align="center" justify="space-between" px="md" py="sm">
            <Flex align="center" gap="sm">
              <Box w={20} h={20} style={{ backgroundColor: 'var(--chatbox-tint-brand)', borderRadius: 4 }} />
              <Text fw={700} size="lg">
                Chatbox
              </Text>
            </Flex>
            <ActionIcon variant="subtle" color="gray" size={20}>
              <IconLayoutSidebarLeftCollapse size={16} />
            </ActionIcon>
          </Flex>
          <SegmentedControl
            value="chat"
            data={[
              { label: 'Chat', value: 'chat' },
              { label: 'Task', value: 'task' },
            ]}
            size="xs"
            fullWidth
            mx="xs"
            mb="xs"
          />
          <ScrollArea flex={1}>
            <SessionItem name="React Server Components" selected={true} starred />
            <SessionItem name="Python Data Pipeline" selected={false} />
            <SessionItem name="CSS Grid Debugging" selected={false} />
            <SessionItem name="API Rate Limiting" selected={false} starred />
            <SessionItem name="Database Schema" selected={false} />
            <SessionItem name="TypeScript Generics" selected={false} />
          </ScrollArea>
          <Stack gap={0} px="xs" pb="xs">
            <Divider mb="xs" />
            <Button variant="light" size="sm" fullWidth mb="xs">
              <IconCirclePlus size={16} className="mr-2" /> New Chat
            </Button>
            <NavItem icon={IconMessageChatbot} label="My Copilots" />
            <NavItem icon={IconSettingsFilled} label="Settings" />
            <NavItem icon={IconHelpCircle} label="Help" />
            <NavItem icon={IconInfoCircle} label="About (v1.18)" />
          </Stack>
        </Stack>
      </Box>

      {/* Main Content */}
      <Stack flex={1} gap={0} className="min-w-0">
        {/* Header */}
        <Flex h={54} align="center" px="sm" className="flex-shrink-0">
          <Flex align="center" gap="xxs" flex={1}>
            <Title order={4} fz={20} lineClamp={1}>
              React Server Components
            </Title>
            <ActionIcon variant="subtle" color="gray" size={20}>
              <IconPencil size={16} />
            </ActionIcon>
          </Flex>
          <Flex align="center" gap="md">
            <Button h={28} px="xs" variant="outline" color="gray" leftSection={<IconSearch size={14} />}>
              Search...
            </Button>
            <ActionIcon variant="subtle" color="gray" size={28}>
              <IconHistory size={18} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="gray" size={28}>
              <IconDots size={18} />
            </ActionIcon>
          </Flex>
        </Flex>
        <Divider />

        {/* Message Area */}
        <ScrollArea flex={1} px="md" py="md">
          <Box className="max-w-4xl mx-auto">
            <Flex gap="sm" py="xs">
              <Avatar size={36} color="blue" radius="xl">
                <IconUser size={18} />
              </Avatar>
              <Box className="bg-chatbox-background-secondary px-4 py-2 rounded-lg">
                <Text size="sm">Can you explain RSC vs traditional client rendering?</Text>
              </Box>
            </Flex>

            <Flex gap="sm" py="xs">
              <Avatar size={36} color="teal" radius="xl">
                <IconRobot size={18} />
              </Avatar>
              <Stack gap={4} flex={1}>
                <Text size="sm">
                  React Server Components (RSC) run on the server, while traditional components run in the browser. RSC
                  can access server resources directly and reduce bundle size.
                </Text>
                <Text size="xs" c="chatbox-tertiary">
                  model: gpt-4o, tokens used: 156
                </Text>
                <ActionBar />
              </Stack>
            </Flex>

            <Flex gap="sm" py="xs">
              <Avatar size={36} color="blue" radius="xl">
                <IconUser size={18} />
              </Avatar>
              <Box className="bg-chatbox-background-secondary px-4 py-2 rounded-lg">
                <Text size="sm">What about data fetching patterns?</Text>
              </Box>
            </Flex>

            <Flex gap="sm" py="xs">
              <Avatar size={36} color="teal" radius="xl">
                <IconRobot size={18} />
              </Avatar>
              <Stack gap={4} flex={1}>
                <Text size="sm">
                  With RSC, you can fetch data directly in the component using async/await. No need for useEffect or
                  complex data fetching libraries. The data is fetched on the server and streamed to the client as HTML.
                </Text>
                <Text size="xs" c="chatbox-tertiary">
                  model: gpt-4o, tokens used: 89
                </Text>
                <ActionBar />
              </Stack>
            </Flex>
          </Box>
        </ScrollArea>

        {/* Input */}
        <Box px="sm" pb="sm">
          <Stack className="max-w-4xl mx-auto" gap="xs">
            <Stack
              className="rounded-md px-3 py-2 min-h-[92px]"
              style={{
                backgroundColor: 'var(--chatbox-background-secondary)',
                border: '1px solid var(--chatbox-border-primary)',
              }}
              gap="xs"
            >
              <Flex align="flex-end" gap={4}>
                <Textarea
                  unstyled
                  classNames={{
                    root: 'flex-1',
                    input: 'block w-full outline-none border-none px-2 py-1 resize-none bg-transparent',
                  }}
                  placeholder="Type your question here..."
                  autosize
                  minRows={2}
                />
                <ActionIcon size={32} variant="filled" color="blue" radius="xl" className="mb-1">
                  <IconArrowUp size={16} />
                </ActionIcon>
              </Flex>
              <Flex align="center" justify="space-between">
                <Flex gap={0}>
                  <ToolBtn icon={IconCirclePlus} />
                  <ToolBtn icon={IconVocabulary} />
                  <ToolBtn icon={IconWorldWww} active />
                  <ToolBtn icon={IconFilePencil} />
                  <ToolBtn icon={IconAdjustmentsHorizontal} />
                </Flex>
                <Flex align="center" gap={0}>
                  <Text size="xs" c="chatbox-tertiary" px="sm">
                    ↑ 1,234 (15%)
                  </Text>
                  <Text size="sm" c="chatbox-secondary">
                    GPT-4o
                  </Text>
                </Flex>
              </Flex>
            </Stack>
          </Stack>
        </Box>
      </Stack>
    </Flex>
  ),
}

export const OptimizedLayout: StoryObj = {
  name: 'Optimized Full Layout',
  render: () => (
    <Box
      style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
        height: '100vh',
        width: '100%',
        backgroundColor: 'var(--chatbox-background-primary)',
      }}
    >
      {/* Sidebar — CSS Grid column */}
      <Box style={{ borderRight: '1px solid var(--chatbox-border-primary)', display: 'flex', flexDirection: 'column' }}>
        <Flex align="center" justify="space-between" px="md" py="sm">
          <Text fw={700} size="lg">
            Chatbox
          </Text>
          <Flex gap={4}>
            <ActionIcon variant="subtle" color="gray" size={24} radius="md">
              <IconSearch size={14} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="gray" size={24} radius="md">
              <IconLayoutSidebarLeftCollapse size={14} />
            </ActionIcon>
          </Flex>
        </Flex>

        <Box px="xs" mb="xs">
          <Button variant="light" fullWidth size="sm" radius="md" leftSection={<IconCirclePlus size={16} />}>
            New Chat
          </Button>
        </Box>

        <ScrollArea flex={1}>
          <Text size="10px" fw={600} c="chatbox-tertiary" px="sm" py={4} tt="uppercase">
            ⭐ Pinned
          </Text>
          <SessionItem name="React Server Components" selected={true} starred />
          <SessionItem name="API Rate Limiting" selected={false} starred />

          <Text size="10px" fw={600} c="chatbox-tertiary" px="sm" py={4} mt="xs" tt="uppercase">
            Today
          </Text>
          <SessionItem name="Python Data Pipeline" selected={false} />
          <SessionItem name="CSS Grid Debugging" selected={false} />

          <Text size="10px" fw={600} c="chatbox-tertiary" px="sm" py={4} mt="xs" tt="uppercase">
            Yesterday
          </Text>
          <SessionItem name="Database Schema" selected={false} />
          <SessionItem name="TypeScript Generics" selected={false} />
        </ScrollArea>

        <Divider />
        <Flex align="center" justify="center" gap="md" py="sm">
          <Tooltip label="My Copilots" withArrow>
            <ActionIcon variant="subtle" color="gray" size={32} radius="md">
              <IconMessageChatbot size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Settings" withArrow>
            <ActionIcon variant="subtle" color="gray" size={32} radius="md">
              <IconSettingsFilled size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Help" withArrow>
            <ActionIcon variant="subtle" color="gray" size={32} radius="md">
              <IconHelpCircle size={18} />
            </ActionIcon>
          </Tooltip>
        </Flex>
      </Box>

      {/* Main Content — CSS Grid column */}
      <Box style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header with breadcrumb */}
        <Flex h={48} align="center" px="md" className="flex-shrink-0">
          <Stack gap={0} flex={1} className="min-w-0">
            <Flex align="center" gap={4}>
              <Text size="xs" c="chatbox-tertiary">
                Chat /
              </Text>
              <Text size="sm" fw={500} lineClamp={1}>
                React Server Components
              </Text>
              <Badge size="xs" variant="light" color="gray" ml={4}>
                Thread 1
              </Badge>
            </Flex>
          </Stack>
          <Flex align="center" gap={4}>
            <Tooltip label="⌘K" withArrow>
              <Button h={28} px="xs" radius="md" variant="light" color="gray" leftSection={<IconSearch size={14} />}>
                Search
              </Button>
            </Tooltip>
            <ActionIcon variant="subtle" color="gray" size={28} radius="md">
              <IconHistory size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="gray" size={28} radius="md">
              <IconDots size={16} />
            </ActionIcon>
          </Flex>
        </Flex>
        <Box h={2} style={{ background: 'linear-gradient(to right, var(--chatbox-tint-brand), transparent)' }} />

        {/* Messages */}
        <ScrollArea flex={1} px="md" py="md">
          <Box className="max-w-3xl mx-auto">
            {/* User */}
            <Flex justify="flex-end" py="xs">
              <Box
                className="px-4 py-3 rounded-2xl rounded-tr-sm max-w-[85%]"
                style={{
                  backgroundColor: 'var(--chatbox-background-brand-secondary)',
                  border: '1px solid var(--chatbox-border-brand)',
                }}
              >
                <Text size="sm">Can you explain RSC vs traditional client rendering?</Text>
              </Box>
            </Flex>

            {/* Assistant */}
            <Flex gap="sm" py="sm">
              <Avatar size={32} color="teal" radius="xl" className="flex-shrink-0 mt-1">
                <IconRobot size={16} />
              </Avatar>
              <Stack gap="xs" flex={1}>
                <Box
                  className="px-4 py-3 rounded-2xl rounded-tl-sm"
                  style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
                >
                  <Text size="sm">
                    RSC run on the server and can access databases directly. They send only rendered HTML, reducing
                    bundle size. Client components handle interactivity.
                  </Text>
                </Box>
                <Flex align="center" justify="space-between">
                  <Flex gap={4}>
                    <Text size="10px" c="chatbox-tertiary" ff="monospace">
                      gpt-4o
                    </Text>
                    <Text size="10px" c="chatbox-tertiary">
                      ·
                    </Text>
                    <Text size="10px" c="chatbox-tertiary">
                      156 tokens
                    </Text>
                    <Text size="10px" c="chatbox-tertiary">
                      ·
                    </Text>
                    <Text size="10px" c="chatbox-tertiary">
                      1.2s
                    </Text>
                  </Flex>
                  <ActionBar />
                </Flex>
              </Stack>
            </Flex>

            {/* User */}
            <Flex justify="flex-end" py="xs">
              <Box
                className="px-4 py-3 rounded-2xl rounded-tr-sm max-w-[85%]"
                style={{
                  backgroundColor: 'var(--chatbox-background-brand-secondary)',
                  border: '1px solid var(--chatbox-border-brand)',
                }}
              >
                <Text size="sm">What about data fetching patterns?</Text>
              </Box>
            </Flex>

            {/* Assistant */}
            <Flex gap="sm" py="sm">
              <Avatar size={32} color="teal" radius="xl" className="flex-shrink-0 mt-1">
                <IconRobot size={16} />
              </Avatar>
              <Stack gap="xs" flex={1}>
                <Box
                  className="px-4 py-3 rounded-2xl rounded-tl-sm"
                  style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
                >
                  <Text size="sm">
                    With RSC, fetch data directly using async/await — no useEffect needed. Data is fetched on the server
                    and streamed as HTML.
                  </Text>
                </Box>
                <Flex align="center" justify="space-between">
                  <Flex gap={4}>
                    <Text size="10px" c="chatbox-tertiary" ff="monospace">
                      gpt-4o
                    </Text>
                    <Text size="10px" c="chatbox-tertiary">
                      ·
                    </Text>
                    <Text size="10px" c="chatbox-tertiary">
                      89 tokens
                    </Text>
                  </Flex>
                  <ActionBar />
                </Flex>
              </Stack>
            </Flex>
          </Box>
        </ScrollArea>

        {/* Input Box */}
        <Box px="md" pb="sm">
          <Box
            className="max-w-3xl mx-auto rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--chatbox-border-primary)' }}
          >
            <Flex
              align="center"
              justify="space-between"
              px="sm"
              py={6}
              style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
            >
              <Flex align="center" gap="xs">
                <Badge variant="light" color="blue" size="sm" radius="sm">
                  🤖 GPT-4o
                </Badge>
                <Badge size="xs" variant="dot" color="blue">
                  Web Search
                </Badge>
              </Flex>
              <Text size="xs" c="chatbox-tertiary" ff="monospace">
                1,234 / 128K
              </Text>
            </Flex>
            <Box h={2} style={{ backgroundColor: 'var(--chatbox-background-tertiary)' }}>
              <Box h={2} w="15%" style={{ backgroundColor: 'var(--chatbox-tint-success)' }} />
            </Box>
            <Box px="sm" py="xs">
              <Textarea
                unstyled
                classNames={{
                  root: 'flex-1',
                  input: 'block w-full outline-none border-none py-1 resize-none bg-transparent',
                }}
                placeholder="Type your question here..."
                autosize
                minRows={2}
              />
            </Box>
            <Flex
              align="center"
              justify="space-between"
              px="sm"
              py={6}
              style={{ borderTop: '1px solid var(--chatbox-border-primary)' }}
            >
              <Flex gap={2}>
                <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                  <IconCirclePlus size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                  <IconVocabulary size={16} />
                </ActionIcon>
                <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                  <IconAdjustmentsHorizontal size={16} />
                </ActionIcon>
              </Flex>
              <ActionIcon size={32} variant="filled" color="blue" radius="xl">
                <IconArrowUp size={16} />
              </ActionIcon>
            </Flex>
          </Box>
        </Box>
      </Box>
    </Box>
  ),
}

function NavItem({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <Flex
      align="center"
      gap="sm"
      px="sm"
      py={6}
      className="rounded cursor-pointer hover:bg-chatbox-background-gray-secondary"
    >
      <Icon size={18} color="var(--chatbox-tint-secondary)" />
      <Text size="sm" c="chatbox-secondary">
        {label}
      </Text>
    </Flex>
  )
}

function ToolBtn({ icon: Icon, active }: { icon: React.ElementType; active?: boolean }) {
  return (
    <ActionIcon variant="subtle" size={28} radius="md" color={active ? 'blue' : 'gray'} p={4}>
      <Icon size={18} />
    </ActionIcon>
  )
}
