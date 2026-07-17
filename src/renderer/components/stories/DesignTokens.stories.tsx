import { Box, Flex, Grid, Stack, Text, Title } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

const meta: Meta = {
  title: 'Design System/Design Tokens',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: `
## Design Tokens Overview

Chatbox uses CSS custom properties (design tokens) for theming. These tokens are defined in \`globals.css\`
and consumed via Tailwind and Mantine. The system supports light and dark modes automatically.

### Optimization Suggestions

1. **Token Naming Consistency**: The current tokens use a flat \`chatbox-*\` namespace. Consider adopting a
   more structured naming convention like \`--cb-color-bg-primary\` for better discoverability.

2. **Missing Semantic Tokens**: Add semantic tokens for common patterns like \`--cb-message-bg-user\`,
   \`--cb-message-bg-assistant\` to make chat-specific styling more maintainable.

3. **Transition Tokens**: Define standard transition durations and easing functions as tokens
   (e.g. \`--cb-transition-fast: 150ms\`, \`--cb-transition-normal: 200ms\`) for consistent animation behavior.

4. **Shadow Tokens**: The project lacks standardized shadow tokens. Adding \`--cb-shadow-sm\`, \`--cb-shadow-md\`,
   \`--cb-shadow-lg\` would improve elevation consistency across components.
        `,
      },
    },
  },
}

export default meta

const ColorSwatch = ({ label, cssVar, value }: { label: string; cssVar: string; value?: string }) => (
  <Flex align="center" gap="sm" py={4}>
    <Box
      w={40}
      h={40}
      style={{
        backgroundColor: `var(${cssVar})`,
        borderRadius: 6,
        border: '1px solid var(--chatbox-border-primary)',
        flexShrink: 0,
      }}
    />
    <Stack gap={0}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      <Text size="xs" c="dimmed" ff="monospace">
        {cssVar}
      </Text>
    </Stack>
  </Flex>
)

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Stack gap="sm" mb="xl">
    <Title order={4} c="chatbox-primary">
      {title}
    </Title>
    {children}
  </Stack>
)

export const Colors: StoryObj = {
  name: 'Color Tokens',
  render: () => (
    <Box p="lg" style={{ maxWidth: 900 }}>
      <Title order={2} mb="lg">
        Color System
      </Title>
      <Text c="dimmed" mb="xl">
        All colors are defined as CSS custom properties and switch automatically between light and dark modes.
      </Text>

      <Grid>
        <Grid.Col span={6}>
          <Section title="Tint Colors (Text)">
            <ColorSwatch label="Primary" cssVar="--chatbox-tint-primary" />
            <ColorSwatch label="Secondary" cssVar="--chatbox-tint-secondary" />
            <ColorSwatch label="Tertiary" cssVar="--chatbox-tint-tertiary" />
            <ColorSwatch label="Disabled" cssVar="--chatbox-tint-disabled" />
            <ColorSwatch label="Brand" cssVar="--chatbox-tint-brand" />
            <ColorSwatch label="Error" cssVar="--chatbox-tint-error" />
            <ColorSwatch label="Warning" cssVar="--chatbox-tint-warning" />
            <ColorSwatch label="Success" cssVar="--chatbox-tint-success" />
          </Section>
        </Grid.Col>
        <Grid.Col span={6}>
          <Section title="Background Colors">
            <ColorSwatch label="Primary" cssVar="--chatbox-background-primary" />
            <ColorSwatch label="Secondary" cssVar="--chatbox-background-secondary" />
            <ColorSwatch label="Tertiary" cssVar="--chatbox-background-tertiary" />
            <ColorSwatch label="Brand Primary" cssVar="--chatbox-background-brand-primary" />
            <ColorSwatch label="Brand Secondary" cssVar="--chatbox-background-brand-secondary" />
            <ColorSwatch label="Error Secondary" cssVar="--chatbox-background-error-secondary" />
          </Section>

          <Section title="Border Colors">
            <ColorSwatch label="Primary" cssVar="--chatbox-border-primary" />
            <ColorSwatch label="Secondary" cssVar="--chatbox-border-secondary" />
            <ColorSwatch label="Brand" cssVar="--chatbox-border-brand" />
            <ColorSwatch label="Error" cssVar="--chatbox-border-error" />
          </Section>
        </Grid.Col>
      </Grid>
    </Box>
  ),
}

export const Spacing: StoryObj = {
  name: 'Spacing Tokens',
  render: () => (
    <Box p="lg" style={{ maxWidth: 600 }}>
      <Title order={2} mb="lg">
        Spacing Scale
      </Title>
      <Text c="dimmed" mb="xl">
        Spacing tokens used throughout the application. Mapped to both Tailwind utility classes and CSS custom
        properties.
      </Text>
      {[
        { name: 'none', var: '--chatbox-spacing-none', px: '0' },
        { name: '3xs', var: '--chatbox-spacing-3xs', px: '2' },
        { name: 'xxs', var: '--chatbox-spacing-xxs', px: '4' },
        { name: 'xs', var: '--chatbox-spacing-xs', px: '8' },
        { name: 'sm', var: '--chatbox-spacing-sm', px: '12' },
        { name: 'md', var: '--chatbox-spacing-md', px: '16' },
        { name: 'lg', var: '--chatbox-spacing-lg', px: '20' },
        { name: 'xl', var: '--chatbox-spacing-xl', px: '24' },
        { name: 'xxl', var: '--chatbox-spacing-xxl', px: '32' },
      ].map((s) => (
        <Flex key={s.name} align="center" gap="md" mb="xs">
          <Text size="sm" w={40} fw={500}>
            {s.name}
          </Text>
          <Box
            h={20}
            style={{
              width: `var(${s.var})`,
              backgroundColor: 'var(--chatbox-tint-brand)',
              borderRadius: 4,
              minWidth: 2,
            }}
          />
          <Text size="xs" c="dimmed" ff="monospace">
            {s.var} ({s.px}px)
          </Text>
        </Flex>
      ))}
    </Box>
  ),
}

export const BorderRadius: StoryObj = {
  name: 'Border Radius',
  render: () => (
    <Box p="lg" style={{ maxWidth: 600 }}>
      <Title order={2} mb="lg">
        Border Radius Scale
      </Title>
      <Flex gap="lg" wrap="wrap">
        {[
          { name: 'none', var: '--chatbox-radius-none' },
          { name: 'xs', var: '--chatbox-radius-xs' },
          { name: 'sm', var: '--chatbox-radius-sm' },
          { name: 'md', var: '--chatbox-radius-md' },
          { name: 'lg', var: '--chatbox-radius-lg' },
          { name: 'xl', var: '--chatbox-radius-xl' },
          { name: 'xxl', var: '--chatbox-radius-xxl' },
        ].map((r) => (
          <Stack key={r.name} align="center" gap={4}>
            <Box
              w={60}
              h={60}
              style={{
                backgroundColor: 'var(--chatbox-background-brand-primary)',
                borderRadius: `var(${r.var})`,
              }}
            />
            <Text size="xs" fw={500}>
              {r.name}
            </Text>
          </Stack>
        ))}
      </Flex>
    </Box>
  ),
}
