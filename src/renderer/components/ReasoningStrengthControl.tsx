import { ActionIcon, Menu, Text, Tooltip } from '@mantine/core'
import { IconBrain, IconCheck } from '@tabler/icons-react'
import type { ReasoningStrength, SessionSettings } from '@shared/types'
import { getSessionReasoningStrength, mapReasoningStrength, REASONING_STRENGTHS } from '@shared/utils/reasoning-strength'

const LABELS: Record<ReasoningStrength, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'MAX',
}

export function ReasoningStrengthControl({
  settings,
  onChange,
  compact = false,
}: {
  settings?: SessionSettings
  onChange: (strength: ReasoningStrength) => void
  compact?: boolean
}) {
  const value = getSessionReasoningStrength(settings) || 'medium'
  const mapping = mapReasoningStrength(value, settings?.provider, settings?.modelId)
  const label = mapping.exact ? LABELS[value] : `${LABELS[value]}*`

  return (
    <Menu withinPortal position="top-end" shadow="md">
      <Menu.Target>
        <Tooltip label={`Reasoning: ${label}${mapping.exact ? '' : ' (model/provider limitation)'}`} withArrow>
          <ActionIcon variant="subtle" color={mapping.exact ? 'gray' : 'yellow'} size={compact ? 28 : 32} aria-label="Reasoning strength">
            <IconBrain size={compact ? 17 : 19} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown miw={170}>
        <Menu.Label>Reasoning strength</Menu.Label>
        {REASONING_STRENGTHS.map((strength) => (
          <Menu.Item
            key={strength}
            onClick={() => onChange(strength)}
            rightSection={value === strength ? <IconCheck size={14} /> : undefined}
          >
            <Text size="sm">{LABELS[strength]}</Text>
          </Menu.Item>
        ))}
        {!mapping.exact && (
          <Text size="xs" c="dimmed" px="sm" py={4}>
            * This model may use its own fixed reasoning mode.
          </Text>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
