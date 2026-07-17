import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Image,
  Input,
  NavLink,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconCirclePlus,
  IconDots,
  IconHelpCircle,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconMessageChatbot,
  IconPhotoPlus,
  IconRobot,
  IconSearch,
  IconSettingsFilled,
  IconStar,
  IconStarFilled,
} from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

const meta: Meta = {
  title: 'Layout/Session Sidebar',
  parameters: {
    docs: {
      description: {
        component: `
## Sidebar Analysis

### Current Issues

1. **MUI SwipeableDrawer**: The sidebar uses MUI's SwipeableDrawer which adds 50KB+ to the bundle
   just for the drawer functionality. Mantine has its own Drawer component.
2. **Flat Session List**: All sessions displayed in a flat list without any grouping or categorization.
   With many sessions, this becomes hard to navigate.
3. **Limited Visual Hierarchy**: All sessions look identical except for the selected state highlight.
   No visual distinction between session types, ages, or activity.
4. **Bottom Navigation Density**: Settings, Help, About, Copilots are all in a flat NavLink list
   with equal visual weight.

### Optimization Suggestions

1. **Replace MUI Drawer with Mantine Drawer or CSS-based sidebar**: Eliminate the MUI dependency.
   Use Mantine's \`Drawer\` or a pure CSS sidebar with \`transform\` transitions.
2. **Session Grouping**: Group sessions by date (Today, Yesterday, Last 7 days, Older) or by
   user-defined folders/tags for better organization.
3. **Session Preview**: Show first message preview or last message timestamp under the session name.
4. **Quick Actions**: Add swipe-to-archive and swipe-to-delete on mobile; right-click context menu on desktop.
5. **Pinned Sessions**: Allow pinning important sessions to the top of the list.
6. **Search-as-you-type**: The search input could filter sessions in real-time with highlighted matches.
7. **Compact Bottom Nav**: Collapse bottom navigation into an icon bar to give more space to the session list.
        `,
      },
    },
  },
}

export default meta

const mockSessions = [
  { id: '1', name: 'React Server Components Deep Dive', starred: true, type: 'chat', time: '2 min ago' },
  { id: '2', name: 'Python Data Pipeline Architecture', starred: false, type: 'chat', time: '1 hour ago' },
  { id: '3', name: 'CSS Grid Layout Debugging', starred: false, type: 'chat', time: '3 hours ago' },
  { id: '4', name: 'API Rate Limiting Strategy', starred: true, type: 'chat', time: 'Yesterday' },
  { id: '5', name: 'Database Schema Design', starred: false, type: 'chat', time: 'Yesterday' },
  { id: '6', name: 'TypeScript Generics Guide', starred: false, type: 'chat', time: '3 days ago' },
  { id: '7', name: 'Docker Compose Setup', starred: false, type: 'chat', time: '1 week ago' },
]

const SessionItemCurrent = ({ name, starred, selected }: { name: string; starred: boolean; selected: boolean }) => (
  <Flex
    align="center"
    className={`cursor-pointer rounded-sm ${selected ? 'bg-chatbox-background-brand-secondary' : 'hover:bg-chatbox-background-gray-secondary'}`}
    mx="xs"
    px="xs"
    py={10}
    gap={10}
  >
    <Avatar size="sm" color={selected ? 'blue' : 'gray'} radius="xl">
      <IconRobot size={14} />
    </Avatar>
    <Text span flex={1} lineClamp={1} c={selected ? 'chatbox-brand' : 'chatbox-primary'} size="sm">
      {name}
    </Text>
    <ActionIcon variant="transparent" size={20} color={starred ? 'blue' : 'gray'}>
      {starred ? <IconStarFilled size={14} /> : <IconDots size={14} />}
    </ActionIcon>
  </Flex>
)

export const CurrentSidebar: StoryObj = {
  name: 'Current Sidebar',
  render: () => (
    <Box
      style={{
        width: 280,
        height: 600,
        border: '1px solid var(--chatbox-border-primary)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <Stack h="100%" gap={0} style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
        <Flex align="center" justify="space-between" px="md" py="sm">
          <Flex align="center" gap="sm">
            <Box w={20} h={20} style={{ backgroundColor: 'var(--chatbox-tint-brand)', borderRadius: 4 }} />
            <Text span c="chatbox-secondary" size="xl" lh={1.2} fw="700">
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
          {mockSessions.map((s, i) => (
            <SessionItemCurrent key={s.id} name={s.name} starred={s.starred} selected={i === 0} />
          ))}
        </ScrollArea>

        <Stack gap={0} px="xs" pb="xs">
          <Divider mb="xs" />
          <Button variant="light" fullWidth size="sm" mb="xs">
            <IconCirclePlus size={16} className="mr-2" /> New Chat
          </Button>
          <Button variant="light" fullWidth size="sm" mb="xs">
            <IconPhotoPlus size={16} className="mr-2" /> Create Image
          </Button>
          <NavLink
            label="My Copilots"
            leftSection={<IconMessageChatbot size={18} />}
            c="chatbox-secondary"
            p="xs"
            className="rounded"
          />
          <NavLink
            label="Settings"
            leftSection={<IconSettingsFilled size={18} />}
            c="chatbox-secondary"
            p="xs"
            className="rounded"
          />
          <NavLink
            label="Help"
            leftSection={<IconHelpCircle size={18} />}
            c="chatbox-secondary"
            p="xs"
            className="rounded"
          />
          <NavLink
            label="About (v1.18)"
            leftSection={<IconInfoCircle size={18} />}
            c="chatbox-tertiary"
            p="xs"
            className="rounded"
          />
        </Stack>
      </Stack>
    </Box>
  ),
}

export const OptimizedSidebar: StoryObj = {
  name: 'Optimized: Grouped with Date Headers',
  render: () => (
    <Box
      style={{
        width: 280,
        height: 600,
        border: '1px solid var(--chatbox-border-primary)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <Stack h="100%" gap={0} style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
        {/* Header */}
        <Flex align="center" justify="space-between" px="md" py="sm">
          <Text fw={700} size="lg" c="chatbox-primary">
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

        {/* Quick New Chat */}
        <Box px="xs" mb="xs">
          <Button variant="light" fullWidth size="sm" radius="md" leftSection={<IconCirclePlus size={16} />}>
            New Chat
          </Button>
        </Box>

        {/* Session List with Date Grouping */}
        <ScrollArea flex={1} px={4}>
          {/* Pinned */}
          <Text size="10px" fw={600} c="chatbox-tertiary" px="sm" py={4} tt="uppercase">
            ⭐ Pinned
          </Text>
          {mockSessions
            .filter((s) => s.starred)
            .map((s) => (
              <Flex
                key={s.id}
                align="center"
                mx="xs"
                px="xs"
                py={8}
                gap={8}
                className="cursor-pointer rounded-md hover:bg-chatbox-background-gray-secondary"
              >
                <Avatar size={28} color="blue" radius="md" variant="light">
                  <IconRobot size={14} />
                </Avatar>
                <Stack gap={0} flex={1} className="min-w-0">
                  <Text size="sm" lineClamp={1} fw={500}>
                    {s.name}
                  </Text>
                  <Text size="10px" c="chatbox-tertiary">
                    {s.time}
                  </Text>
                </Stack>
                <IconStarFilled size={12} color="var(--chatbox-tint-brand)" />
              </Flex>
            ))}

          {/* Today */}
          <Text size="10px" fw={600} c="chatbox-tertiary" px="sm" py={4} mt="xs" tt="uppercase">
            Today
          </Text>
          {mockSessions
            .filter((s) => !s.starred)
            .slice(0, 3)
            .map((s, i) => (
              <Flex
                key={s.id}
                align="center"
                mx="xs"
                px="xs"
                py={8}
                gap={8}
                className={`cursor-pointer rounded-md ${i === 0 ? 'bg-chatbox-background-brand-secondary' : 'hover:bg-chatbox-background-gray-secondary'}`}
              >
                <Avatar size={28} color={i === 0 ? 'blue' : 'gray'} radius="md" variant="light">
                  <IconRobot size={14} />
                </Avatar>
                <Stack gap={0} flex={1} className="min-w-0">
                  <Text size="sm" lineClamp={1} c={i === 0 ? 'chatbox-brand' : 'chatbox-primary'}>
                    {s.name}
                  </Text>
                  <Text size="10px" c="chatbox-tertiary">
                    {s.time}
                  </Text>
                </Stack>
              </Flex>
            ))}

          {/* Yesterday */}
          <Text size="10px" fw={600} c="chatbox-tertiary" px="sm" py={4} mt="xs" tt="uppercase">
            Yesterday
          </Text>
          {mockSessions
            .filter((s) => !s.starred)
            .slice(3, 5)
            .map((s) => (
              <Flex
                key={s.id}
                align="center"
                mx="xs"
                px="xs"
                py={8}
                gap={8}
                className="cursor-pointer rounded-md hover:bg-chatbox-background-gray-secondary"
              >
                <Avatar size={28} color="gray" radius="md" variant="light">
                  <IconRobot size={14} />
                </Avatar>
                <Stack gap={0} flex={1} className="min-w-0">
                  <Text size="sm" lineClamp={1}>
                    {s.name}
                  </Text>
                  <Text size="10px" c="chatbox-tertiary">
                    {s.time}
                  </Text>
                </Stack>
              </Flex>
            ))}

          {/* Older */}
          <Text size="10px" fw={600} c="chatbox-tertiary" px="sm" py={4} mt="xs" tt="uppercase">
            Previous 7 days
          </Text>
          {mockSessions
            .filter((s) => !s.starred)
            .slice(5)
            .map((s) => (
              <Flex
                key={s.id}
                align="center"
                mx="xs"
                px="xs"
                py={8}
                gap={8}
                className="cursor-pointer rounded-md hover:bg-chatbox-background-gray-secondary"
              >
                <Avatar size={28} color="gray" radius="md" variant="light">
                  <IconRobot size={14} />
                </Avatar>
                <Stack gap={0} flex={1} className="min-w-0">
                  <Text size="sm" lineClamp={1}>
                    {s.name}
                  </Text>
                  <Text size="10px" c="chatbox-tertiary">
                    {s.time}
                  </Text>
                </Stack>
              </Flex>
            ))}
        </ScrollArea>

        {/* Compact Bottom Nav */}
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
          <Tooltip label="About v1.18" withArrow>
            <ActionIcon variant="subtle" color="gray" size={32} radius="md">
              <IconInfoCircle size={18} />
            </ActionIcon>
          </Tooltip>
        </Flex>
      </Stack>
    </Box>
  ),
}

export const SessionItemVariants: StoryObj = {
  name: 'Session Item Variants',
  render: () => (
    <Box p="lg" style={{ maxWidth: 320 }}>
      <Title order={3} mb="lg">
        Session Item Variants
      </Title>

      <Stack gap="lg">
        <Box>
          <Text fw={600} size="sm" mb="xs">
            Current: Flat item
          </Text>
          <SessionItemCurrent name="React Server Components Deep Dive" starred={false} selected={false} />
          <SessionItemCurrent name="Understanding React Server Components" starred={true} selected={true} />
        </Box>

        <Box>
          <Text fw={600} size="sm" mb="xs">
            Optimized: With preview & timestamp
          </Text>
          {[
            {
              name: 'React Server Components',
              preview: 'Let me explain the key differences between RSC and...',
              time: '2m ago',
              selected: true,
              badge: 'gpt-4o',
            },
            {
              name: 'Python Pipeline',
              preview: 'The architecture should use a producer-consumer...',
              time: '1h ago',
              selected: false,
              badge: 'claude-3.5',
            },
          ].map((s) => (
            <Flex
              key={s.name}
              align="flex-start"
              mx="xs"
              px="xs"
              py={8}
              gap={8}
              className={`cursor-pointer rounded-md ${s.selected ? 'bg-chatbox-background-brand-secondary' : 'hover:bg-chatbox-background-gray-secondary'}`}
            >
              <Avatar size={32} color={s.selected ? 'blue' : 'gray'} radius="md" variant="light" mt={2}>
                <IconRobot size={16} />
              </Avatar>
              <Stack gap={2} flex={1} className="min-w-0">
                <Flex align="center" justify="space-between">
                  <Text size="sm" fw={500} lineClamp={1} c={s.selected ? 'chatbox-brand' : 'chatbox-primary'}>
                    {s.name}
                  </Text>
                  <Text size="10px" c="chatbox-tertiary" className="flex-shrink-0">
                    {s.time}
                  </Text>
                </Flex>
                <Text size="xs" c="chatbox-tertiary" lineClamp={1}>
                  {s.preview}
                </Text>
                <Badge size="xs" variant="light" color="gray" radius="sm">
                  {s.badge}
                </Badge>
              </Stack>
            </Flex>
          ))}
        </Box>
      </Stack>
    </Box>
  ),
}
