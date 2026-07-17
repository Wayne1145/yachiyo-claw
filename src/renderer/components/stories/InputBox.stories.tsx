import { ActionIcon, Badge, Box, Flex, Menu, Stack, Text, Textarea, Tooltip, UnstyledButton } from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconArrowUp,
  IconCirclePlus,
  IconFilePencil,
  IconFolder,
  IconHammer,
  IconLink,
  IconPhoto,
  IconPlayerStopFilled,
  IconVocabulary,
  IconWorldWww,
  IconX,
} from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React, { useState } from 'react'

const meta: Meta = {
  title: 'Chat/Input Box',
  parameters: {
    docs: {
      description: {
        component: `
## Input Box Analysis

The InputBox component (\`InputBox.tsx\`) is the most complex component at 1300+ lines,
handling input, attachments, file preprocessing, token counting, model selection, and toolbar.

### Current Issues

1. **Monolithic Component**: 1300+ lines mixing input handling, file preprocessing, token counting,
   model selection, drag-drop, clipboard handling, and keyboard shortcuts.
2. **Dense Toolbar**: Bottom toolbar has many icons without clear grouping — attachments, MCP, KB,
   web search, new thread, settings, token count, and model selector all on one line.
3. **Attachment Area**: Image/file/link cards appear inline in the input box without clear separation.
4. **Token Count UX**: Token percentage display mixed with toolbar actions; hard to notice at a glance.

### Optimization Suggestions

1. **Component Decomposition**: Extract into \`InputArea\`, \`AttachmentBar\`, \`ToolBar\`, \`ModelSelector\`,
   \`TokenCounter\` sub-components. Each under 200 lines.
2. **Toolbar Grouping**: Group tools into "Content" (attach, MCP, KB) and "Actions" (new thread, settings)
   with visual separators. Move token count to a progress-bar style indicator below the toolbar.
3. **Attachment Preview**: Move attachments above the textarea in a dedicated preview strip with
   drag-to-reorder support.
4. **Smart Token Bar**: Replace the inline token text with a thin progress bar showing context
   usage at a glance. Color codes: green (<60%), yellow (60-80%), red (>80%).
5. **Floating Model Selector**: Make the model selector more prominent — either a pill badge at the top
   of the input box or a dedicated row, since model selection is a critical decision.
        `,
      },
    },
  },
}

export default meta

const toolbarIconSize = 18

export const CurrentInputBox: StoryObj = {
  name: 'Current Input Box',
  render: () => (
    <Box p="lg" style={{ maxWidth: 720 }}>
      <Text fw={600} size="sm" mb="xs">
        Current Design
      </Text>
      <Stack className="max-w-4xl mx-auto" gap="xs">
        <Stack
          className="rounded-md justify-between px-3 py-2 min-h-[92px]"
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
              size="sm"
              placeholder="Type your question here..."
              autosize
              minRows={2}
              maxRows={6}
            />
            <ActionIcon size={32} variant="filled" color="blue" radius="xl" className="shrink-0 mb-1">
              <IconArrowUp size={16} />
            </ActionIcon>
          </Flex>

          <Flex align="center" gap={0} className="shrink-0 w-full" justify="space-between">
            <Flex align="center" gap={0}>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconCirclePlus
                  size={toolbarIconSize}
                  strokeWidth={1.8}
                  style={{ color: 'var(--chatbox-tint-secondary)' }}
                />
              </UnstyledButton>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconHammer
                  size={toolbarIconSize}
                  strokeWidth={1.8}
                  style={{ color: 'var(--chatbox-tint-secondary)' }}
                />
              </UnstyledButton>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconVocabulary
                  size={toolbarIconSize}
                  strokeWidth={1.8}
                  style={{ color: 'var(--chatbox-tint-secondary)' }}
                />
              </UnstyledButton>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconWorldWww size={toolbarIconSize} strokeWidth={1.8} style={{ color: 'var(--chatbox-tint-brand)' }} />
              </UnstyledButton>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconFilePencil
                  size={toolbarIconSize}
                  strokeWidth={1.8}
                  style={{ color: 'var(--chatbox-tint-secondary)' }}
                />
              </UnstyledButton>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconAdjustmentsHorizontal
                  size={toolbarIconSize}
                  strokeWidth={1.8}
                  style={{ color: 'var(--chatbox-tint-secondary)' }}
                />
              </UnstyledButton>
            </Flex>

            <Flex align="center" gap={0}>
              <Text size="xs" c="chatbox-tertiary" className="px-2 py-1">
                ↑ ~1,234 (15%)
              </Text>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <Text size="sm" c="chatbox-secondary" className="truncate max-w-[160px]">
                  GPT-4o
                </Text>
              </UnstyledButton>
            </Flex>
          </Flex>
        </Stack>
      </Stack>
    </Box>
  ),
}

export const OptimizedInputBox: StoryObj = {
  name: 'Optimized: Structured Layout',
  render: () => (
    <Box p="lg" style={{ maxWidth: 720 }}>
      <Text fw={600} size="sm" mb="xs">
        Optimized — Structured zones with smart token bar
      </Text>
      <Stack className="max-w-4xl mx-auto" gap="xs">
        <Box className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--chatbox-border-primary)' }}>
          {/* Model Selector Row */}
          <Flex
            align="center"
            justify="space-between"
            px="sm"
            py={6}
            style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
          >
            <Flex align="center" gap="xs">
              <Badge variant="light" color="blue" size="sm" radius="sm" leftSection="🤖">
                GPT-4o
              </Badge>
              <Flex gap={4}>
                <Badge size="xs" variant="dot" color="blue" className="cursor-pointer">
                  Web Search
                </Badge>
                <Badge size="xs" variant="dot" color="gray" className="cursor-pointer">
                  MCP Tools
                </Badge>
              </Flex>
            </Flex>
            <Text size="xs" c="chatbox-tertiary" ff="monospace">
              1,234 / 128K tokens
            </Text>
          </Flex>

          {/* Token Progress Bar */}
          <Box h={2} style={{ backgroundColor: 'var(--chatbox-background-tertiary)' }}>
            <Box h={2} w="15%" style={{ backgroundColor: 'var(--chatbox-tint-success)', transition: 'width 0.3s' }} />
          </Box>

          {/* Input Area */}
          <Box px="sm" py="xs" style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
            <Textarea
              unstyled
              classNames={{
                root: 'flex-1',
                input: 'block w-full outline-none border-none py-1 resize-none bg-transparent',
              }}
              placeholder="Type your question here..."
              autosize
              minRows={3}
              maxRows={8}
            />
          </Box>

          {/* Toolbar */}
          <Flex
            align="center"
            justify="space-between"
            px="sm"
            py={6}
            style={{
              backgroundColor: 'var(--chatbox-background-primary)',
              borderTop: '1px solid var(--chatbox-border-primary)',
            }}
          >
            <Flex align="center" gap={2}>
              <Tooltip label="Attach files" withArrow position="top">
                <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                  <IconCirclePlus size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Knowledge Base" withArrow position="top">
                <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                  <IconVocabulary size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="New Thread" withArrow position="top">
                <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                  <IconFilePencil size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Conversation Settings" withArrow position="top">
                <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                  <IconAdjustmentsHorizontal size={16} />
                </ActionIcon>
              </Tooltip>
            </Flex>

            <ActionIcon size={32} variant="filled" color="blue" radius="xl">
              <IconArrowUp size={16} />
            </ActionIcon>
          </Flex>
        </Box>
      </Stack>
    </Box>
  ),
}

export const WithAttachments: StoryObj = {
  name: 'With Attachments Preview',
  render: () => (
    <Box p="lg" style={{ maxWidth: 720 }}>
      <Text fw={600} size="sm" mb="xs">
        Optimized Attachment Preview Strip
      </Text>
      <Stack className="max-w-4xl mx-auto" gap="xs">
        <Box className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--chatbox-border-primary)' }}>
          {/* Attachments Strip */}
          <Flex
            gap="xs"
            px="sm"
            py="xs"
            style={{
              backgroundColor: 'var(--chatbox-background-secondary)',
              borderBottom: '1px solid var(--chatbox-border-primary)',
              overflowX: 'auto',
            }}
          >
            {/* Image Attachment */}
            <Flex
              align="center"
              gap={6}
              px={8}
              py={4}
              style={{
                backgroundColor: 'var(--chatbox-background-primary)',
                borderRadius: 8,
                border: '1px solid var(--chatbox-border-primary)',
                flexShrink: 0,
              }}
            >
              <Box
                w={32}
                h={32}
                style={{ backgroundColor: '#e3f2fd', borderRadius: 4 }}
                className="flex items-center justify-center"
              >
                <IconPhoto size={16} color="var(--chatbox-tint-brand)" />
              </Box>
              <Stack gap={0}>
                <Text size="xs" fw={500} lineClamp={1}>
                  screenshot.png
                </Text>
                <Text size="10px" c="chatbox-tertiary">
                  245 KB
                </Text>
              </Stack>
              <ActionIcon size={16} variant="subtle" color="gray">
                <IconX size={12} />
              </ActionIcon>
            </Flex>

            {/* File Attachment */}
            <Flex
              align="center"
              gap={6}
              px={8}
              py={4}
              style={{
                backgroundColor: 'var(--chatbox-background-primary)',
                borderRadius: 8,
                border: '1px solid var(--chatbox-border-primary)',
                flexShrink: 0,
              }}
            >
              <Box
                w={32}
                h={32}
                style={{ backgroundColor: '#fff3e0', borderRadius: 4 }}
                className="flex items-center justify-center"
              >
                <IconFolder size={16} color="#f57c00" />
              </Box>
              <Stack gap={0}>
                <Text size="xs" fw={500} lineClamp={1}>
                  report.pdf
                </Text>
                <Text size="10px" c="chatbox-tertiary">
                  1.2 MB · Parsing...
                </Text>
              </Stack>
              <ActionIcon size={16} variant="subtle" color="gray">
                <IconX size={12} />
              </ActionIcon>
            </Flex>

            {/* Link Attachment */}
            <Flex
              align="center"
              gap={6}
              px={8}
              py={4}
              style={{
                backgroundColor: 'var(--chatbox-background-primary)',
                borderRadius: 8,
                border: '1px solid var(--chatbox-border-primary)',
                flexShrink: 0,
              }}
            >
              <Box
                w={32}
                h={32}
                style={{ backgroundColor: '#e8f5e9', borderRadius: 4 }}
                className="flex items-center justify-center"
              >
                <IconLink size={16} color="#43a047" />
              </Box>
              <Stack gap={0}>
                <Text size="xs" fw={500} lineClamp={1}>
                  react.dev/docs
                </Text>
                <Text size="10px" c="chatbox-success">
                  Ready
                </Text>
              </Stack>
              <ActionIcon size={16} variant="subtle" color="gray">
                <IconX size={12} />
              </ActionIcon>
            </Flex>
          </Flex>

          {/* Input Area */}
          <Box px="sm" py="xs" style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
            <Textarea
              unstyled
              classNames={{
                root: 'flex-1',
                input: 'block w-full outline-none border-none py-1 resize-none bg-transparent',
              }}
              placeholder="Type your question about the attachments..."
              value="Can you summarize the key points from the attached PDF?"
              autosize
              minRows={2}
            />
          </Box>

          {/* Toolbar */}
          <Flex
            align="center"
            justify="space-between"
            px="sm"
            py={6}
            style={{
              backgroundColor: 'var(--chatbox-background-primary)',
              borderTop: '1px solid var(--chatbox-border-primary)',
            }}
          >
            <Flex align="center" gap={2}>
              <ActionIcon variant="subtle" color="gray" size={28} radius="md">
                <IconCirclePlus size={16} />
              </ActionIcon>
            </Flex>
            <ActionIcon size={32} variant="filled" color="blue" radius="xl">
              <IconArrowUp size={16} />
            </ActionIcon>
          </Flex>
        </Box>
      </Stack>
    </Box>
  ),
}

export const TokenUsageIndicator: StoryObj = {
  name: 'Token Usage Indicator Variants',
  render: () => (
    <Box p="lg" style={{ maxWidth: 600 }}>
      <Stack gap="lg">
        <Text fw={600} size="sm">
          Token Usage Display Variants
        </Text>

        <Box>
          <Text size="xs" c="dimmed" mb="xs">
            Current: Inline text
          </Text>
          <Flex
            px="sm"
            py="xs"
            align="center"
            style={{
              border: '1px solid var(--chatbox-border-primary)',
              borderRadius: 8,
              backgroundColor: 'var(--chatbox-background-secondary)',
            }}
          >
            <Text size="xs" c="chatbox-tertiary">
              ↑ ~1,234 (15%)
            </Text>
          </Flex>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" mb="xs">
            Optimized: Progress bar (low usage — green)
          </Text>
          <Box style={{ border: '1px solid var(--chatbox-border-primary)', borderRadius: 8, overflow: 'hidden' }}>
            <Flex
              px="sm"
              py="xs"
              align="center"
              justify="space-between"
              style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
            >
              <Text size="xs" c="chatbox-tertiary">
                Context: 1,234 tokens
              </Text>
              <Text size="xs" c="chatbox-success" fw={500}>
                15% of 128K
              </Text>
            </Flex>
            <Box h={3} style={{ backgroundColor: 'var(--chatbox-background-tertiary)' }}>
              <Box
                h={3}
                w="15%"
                style={{ backgroundColor: 'var(--chatbox-tint-success)', borderRadius: '0 2px 2px 0' }}
              />
            </Box>
          </Box>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" mb="xs">
            Optimized: Progress bar (medium usage — yellow)
          </Text>
          <Box style={{ border: '1px solid var(--chatbox-border-primary)', borderRadius: 8, overflow: 'hidden' }}>
            <Flex
              px="sm"
              py="xs"
              align="center"
              justify="space-between"
              style={{ backgroundColor: 'var(--chatbox-background-secondary)' }}
            >
              <Text size="xs" c="chatbox-tertiary">
                Context: 89,600 tokens
              </Text>
              <Text size="xs" c="chatbox-warning" fw={500}>
                70% of 128K
              </Text>
            </Flex>
            <Box h={3} style={{ backgroundColor: 'var(--chatbox-background-tertiary)' }}>
              <Box
                h={3}
                w="70%"
                style={{ backgroundColor: 'var(--chatbox-tint-warning)', borderRadius: '0 2px 2px 0' }}
              />
            </Box>
          </Box>
        </Box>

        <Box>
          <Text size="xs" c="dimmed" mb="xs">
            Optimized: Progress bar (high usage — red)
          </Text>
          <Box style={{ border: '1px solid var(--chatbox-border-primary)', borderRadius: 8, overflow: 'hidden' }}>
            <Flex
              px="sm"
              py="xs"
              align="center"
              justify="space-between"
              style={{ backgroundColor: 'var(--chatbox-background-error-secondary)' }}
            >
              <Text size="xs" c="chatbox-error">
                Context: 115,200 tokens
              </Text>
              <Text size="xs" c="chatbox-error" fw={500}>
                90% of 128K — Consider compaction
              </Text>
            </Flex>
            <Box h={3} style={{ backgroundColor: 'var(--chatbox-background-tertiary)' }}>
              <Box
                h={3}
                w="90%"
                style={{ backgroundColor: 'var(--chatbox-tint-error)', borderRadius: '0 2px 2px 0' }}
              />
            </Box>
          </Box>
        </Box>
      </Stack>
    </Box>
  ),
}

export const GeneratingState: StoryObj = {
  name: 'Generating State',
  render: () => (
    <Box p="lg" style={{ maxWidth: 720 }}>
      <Text fw={600} size="sm" mb="xs">
        Input Box during AI Generation
      </Text>
      <Stack className="max-w-4xl mx-auto" gap="xs">
        <Box className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--chatbox-border-primary)' }}>
          <Box px="sm" py="xs" style={{ backgroundColor: 'var(--chatbox-background-primary)' }}>
            <Textarea
              unstyled
              classNames={{
                root: 'flex-1',
                input:
                  'block w-full outline-none border-none py-1 resize-none bg-transparent text-chatbox-tint-disabled',
              }}
              placeholder="Generating response..."
              autosize
              minRows={2}
              disabled
            />
          </Box>
          <Flex
            align="center"
            justify="space-between"
            px="sm"
            py={6}
            style={{
              backgroundColor: 'var(--chatbox-background-primary)',
              borderTop: '1px solid var(--chatbox-border-primary)',
            }}
          >
            <Flex align="center" gap="xs">
              <Text size="xs" c="chatbox-tertiary">
                Generating...
              </Text>
            </Flex>
            <ActionIcon size={32} variant="filled" color="dark" radius="xl">
              <IconPlayerStopFilled size={14} />
            </ActionIcon>
          </Flex>
        </Box>
      </Stack>
    </Box>
  ),
}
