import { ActionIcon, Menu, Text, Tooltip } from '@mantine/core'
import { IconBrain, IconCheck } from '@tabler/icons-react'
import type { ReasoningStrength, SessionSettings } from '@shared/types'
import { getSessionReasoningStrength, mapReasoningStrength, REASONING_STRENGTHS } from '@shared/utils/reasoning-strength'

const LABELS: Record<ReasoningStrength, string> = {
  off: '不思考',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
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
        <Tooltip label={`推理强度：${label}${mapping.exact ? '' : '（当前模型或提供商会自行映射）'}`} withArrow>
          <ActionIcon variant="subtle" color={mapping.exact ? 'gray' : 'yellow'} size={compact ? 28 : 32} aria-label="推理强度" style={{ flex: '0 0 auto' }}>
            <IconBrain size={compact ? 17 : 19} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown miw={170}>
        <Menu.Label>推理强度</Menu.Label>
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
            * 当前模型可能使用固定的推理模式。
          </Text>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
