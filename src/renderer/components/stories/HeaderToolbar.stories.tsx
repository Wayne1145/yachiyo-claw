import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  SegmentedControl,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import {
  IconAdjustments,
  IconDeviceFloppy,
  IconDots,
  IconHistory,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMenu2,
  IconPencil,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

const meta: Meta = {
  title: 'Layout/Header & Toolbar',
  parameters: {
    docs: {
      description: {
        component: `
## Header & Toolbar Analysis

### Current Issues

1. **Fixed 54px Height**: The header uses a static \`h={54}\` which doesn't scale with user font size preferences.
2. **Search Button Inconsistency**: Desktop shows a full "Search..." button while mobile shows an icon — consider
   making the search experience more unified with a command palette approach.
3. **Toolbar Crowding**: On medium screens, the toolbar icons can crowd together. Missing visual grouping.
4. **Title Truncation**: Session title uses \`lineClamp={1}\` but doesn't provide any visual cue that text is truncated.

### Optimization Suggestions

1. **Command Palette**: Replace the search button with a ⌘K-style command palette that handles search, navigation,
   and quick actions in one unified interface.
2. **Breadcrumb-style Title**: Show session path (e.g., "Chat > My Project Discussion > Thread 3") instead of
   just the session name, with each part clickable.
3. **Collapsible Toolbar**: Group toolbar actions into primary (always visible) and secondary (overflow menu)
   based on screen width, using a responsive breakpoint approach.
4. **Status Indicators**: Add subtle indicators in the header for active features (web search, knowledge base,
   MCP tools) so users know the context of their conversation at a glance.
        `,
      },
    },
  },
}

export default meta

export const CurrentHeader: StoryObj = {
  name: 'Current Header',
  render: () => (
    <Stack gap="xl" p="lg" style={{ maxWidth: 900 }}>
      <Box>
        <Text fw={600} size="sm" mb="xs">
          Current Desktop Header
        </Text>
        <Box style={{ border: '1px solid var(--chatbox-border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          <Flex h={54} align="center" px="sm" style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
            <ActionIcon variant="subtle" size={20} color="gray" mr="sm">
              <IconLayoutSidebarLeftExpand size={18} />
            </ActionIcon>

            <Flex align="center" gap="xxs" flex={1}>
              <Title order={4} fz={20} lineClamp={1}>
                Understanding React Server Components in Production
              </Title>
              <ActionIcon variant="subtle" color="gray" size={20}>
                <IconPencil size={16} />
              </ActionIcon>
            </Flex>

            <Flex align="center" gap="md">
              <Button h={28} px="xs" radius="sm" variant="outline" color="gray" leftSection={<IconSearch size={14} />}>
                Search...
              </Button>
              <ActionIcon variant="subtle" size={28} color="gray">
                <IconHistory size={18} />
              </ActionIcon>
              <ActionIcon variant="subtle" size={28} color="gray">
                <IconDots size={18} />
              </ActionIcon>
            </Flex>
          </Flex>
          <Divider />
        </Box>
      </Box>

      <Box>
        <Text fw={600} size="sm" mb="xs">
          Current Mobile Header
        </Text>
        <Box
          style={{
            border: '1px solid var(--chatbox-border-primary)',
            borderRadius: 8,
            overflow: 'hidden',
            maxWidth: 375,
          }}
        >
          <Flex h={54} align="center" px="sm" style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
            <ActionIcon variant="subtle" size={24} color="gray">
              <IconMenu2 size={20} />
            </ActionIcon>

            <Flex align="center" gap="xxs" flex={1} justify="center" px="sm">
              <Title order={4} lineClamp={1} ta="center">
                Understanding RSC
              </Title>
            </Flex>

            <Flex align="center" gap="xs">
              <ActionIcon variant="subtle" size={24} color="gray">
                <IconSearch size={18} />
              </ActionIcon>
              <ActionIcon variant="subtle" size={24} color="gray">
                <IconDots size={18} />
              </ActionIcon>
            </Flex>
          </Flex>
          <Divider />
        </Box>
      </Box>
    </Stack>
  ),
}

export const OptimizedHeader: StoryObj = {
  name: 'Optimized: With Breadcrumb & Status',
  render: () => (
    <Stack gap="xl" p="lg" style={{ maxWidth: 900 }}>
      <Box>
        <Text fw={600} size="sm" mb="xs">
          Optimized Desktop Header — Breadcrumb + Status Indicators
        </Text>
        <Box style={{ border: '1px solid var(--chatbox-border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          <Flex h={54} align="center" px="sm" style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
            <ActionIcon variant="subtle" size={20} color="gray" mr="sm">
              <IconLayoutSidebarLeftExpand size={18} />
            </ActionIcon>

            <Stack gap={0} flex={1} className="min-w-0">
              <Flex align="center" gap={4}>
                <Text size="xs" c="chatbox-tertiary" className="cursor-pointer hover:underline">
                  Chat
                </Text>
                <Text size="xs" c="chatbox-tertiary">
                  /
                </Text>
                <Text size="xs" c="chatbox-secondary" fw={500} lineClamp={1}>
                  Understanding React Server Components
                </Text>
                <ActionIcon variant="subtle" color="gray" size={16}>
                  <IconPencil size={12} />
                </ActionIcon>
              </Flex>
              <Flex align="center" gap="xs">
                <Text size="10px" c="chatbox-tertiary">
                  Thread 3
                </Text>
                <Flex gap={4}>
                  <Badge size="xs" variant="dot" color="blue">
                    Web Search
                  </Badge>
                  <Badge size="xs" variant="dot" color="teal">
                    2 MCP Tools
                  </Badge>
                </Flex>
              </Flex>
            </Stack>

            <Flex align="center" gap="xs">
              <Tooltip label="⌘K" withArrow>
                <Button
                  h={28}
                  px="xs"
                  radius="md"
                  variant="light"
                  color="gray"
                  leftSection={<IconSearch size={14} />}
                  rightSection={
                    <Text size="10px" c="dimmed" ff="monospace">
                      ⌘K
                    </Text>
                  }
                >
                  Search
                </Button>
              </Tooltip>
              <ActionIcon variant="subtle" size={28} color="gray">
                <IconHistory size={18} />
              </ActionIcon>
              <ActionIcon variant="subtle" size={28} color="gray">
                <IconDots size={18} />
              </ActionIcon>
            </Flex>
          </Flex>
          <Divider />
        </Box>
      </Box>

      <Box>
        <Text fw={600} size="sm" mb="xs">
          Optimized Header — Minimal Clean Variant
        </Text>
        <Box style={{ border: '1px solid var(--chatbox-border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          <Flex h={48} align="center" px="md" style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
            <ActionIcon variant="subtle" size={20} color="gray" mr="xs">
              <IconLayoutSidebarLeftCollapse size={18} />
            </ActionIcon>

            <Flex align="center" flex={1} className="min-w-0">
              <Text fw={600} size="sm" lineClamp={1}>
                Understanding React Server Components
              </Text>
              <Badge size="xs" variant="light" color="gray" ml="xs">
                Thread 3
              </Badge>
            </Flex>

            <Flex align="center" gap={4}>
              <ActionIcon variant="subtle" size={28} color="gray" radius="md">
                <IconSearch size={16} />
              </ActionIcon>
              <ActionIcon variant="subtle" size={28} color="gray" radius="md">
                <IconAdjustments size={16} />
              </ActionIcon>
              <ActionIcon variant="subtle" size={28} color="gray" radius="md">
                <IconDots size={16} />
              </ActionIcon>
            </Flex>
          </Flex>
          <Box h={2} style={{ background: 'linear-gradient(to right, var(--chatbox-tint-brand), transparent)' }} />
        </Box>
      </Box>
    </Stack>
  ),
}

export const ToolbarVariants: StoryObj = {
  name: 'Toolbar Action Groups',
  render: () => (
    <Stack gap="xl" p="lg" style={{ maxWidth: 700 }}>
      <Title order={3}>Toolbar Variants</Title>

      <Box>
        <Text fw={600} size="sm" mb="xs">
          Current: Flat Icon Row
        </Text>
        <Flex
          gap="md"
          align="center"
          px="md"
          py="xs"
          style={{
            border: '1px solid var(--chatbox-border-primary)',
            borderRadius: 8,
            backgroundColor: 'var(--chatbox-background-primary)',
          }}
        >
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
      </Box>

      <Box>
        <Text fw={600} size="sm" mb="xs">
          Optimized: Grouped with Dividers
        </Text>
        <Flex
          gap="xs"
          align="center"
          px="md"
          py="xs"
          style={{
            border: '1px solid var(--chatbox-border-primary)',
            borderRadius: 8,
            backgroundColor: 'var(--chatbox-background-primary)',
          }}
        >
          <Flex
            align="center"
            gap={2}
            px={4}
            py={2}
            style={{
              borderRadius: 6,
              backgroundColor: 'var(--chatbox-background-secondary)',
            }}
          >
            <ActionIcon variant="subtle" color="gray" size={24} radius="sm">
              <IconSearch size={14} />
            </ActionIcon>
            <Divider orientation="vertical" h={16} className="self-center" />
            <ActionIcon variant="subtle" color="gray" size={24} radius="sm">
              <IconHistory size={14} />
            </ActionIcon>
          </Flex>

          <Flex
            align="center"
            gap={2}
            px={4}
            py={2}
            style={{
              borderRadius: 6,
              backgroundColor: 'var(--chatbox-background-secondary)',
            }}
          >
            <ActionIcon variant="subtle" color="gray" size={24} radius="sm">
              <IconDeviceFloppy size={14} />
            </ActionIcon>
            <Divider orientation="vertical" h={16} className="self-center" />
            <ActionIcon variant="subtle" color="red" size={24} radius="sm">
              <IconTrash size={14} />
            </ActionIcon>
          </Flex>

          <ActionIcon variant="subtle" color="gray" size={24} radius="sm">
            <IconDots size={14} />
          </ActionIcon>
        </Flex>
      </Box>

      <Box>
        <Text fw={600} size="sm" mb="xs">
          Optimized: Segmented Toolbar
        </Text>
        <Flex
          gap="xs"
          align="center"
          px="md"
          py="xs"
          style={{
            border: '1px solid var(--chatbox-border-primary)',
            borderRadius: 8,
            backgroundColor: 'var(--chatbox-background-primary)',
          }}
        >
          <SegmentedControl
            size="xs"
            data={[
              { label: '🔍 Search', value: 'search' },
              { label: '📋 History', value: 'history' },
              { label: '⚙️ Settings', value: 'settings' },
            ]}
          />
        </Flex>
      </Box>
    </Stack>
  ),
}
