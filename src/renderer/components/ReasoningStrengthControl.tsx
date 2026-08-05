import { ActionIcon, Menu, Text, Tooltip } from '@mantine/core'
import { IconBrain, IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { ReasoningStrength, SessionSettings } from '@shared/types'
import {
  getSessionReasoningStrength,
  mapReasoningStrength,
  REASONING_STRENGTHS,
} from '@shared/utils/reasoning-strength'

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
  display = 'icon',
}: {
  settings?: SessionSettings
  onChange: (strength: ReasoningStrength) => void
  compact?: boolean
  display?: 'icon' | 'label'
}) {
  const { t } = useTranslation()
  const value = getSessionReasoningStrength(settings) || 'medium'
  const mapping = mapReasoningStrength(value, settings?.provider, settings?.modelId)
  const label = t(LABELS[value])
  const mappingNote = mapping.exact ? '' : t('（当前模型或提供商会自行映射）')

  return (
    <Menu withinPortal position="top-end" shadow="md">
      <Menu.Target>
        <Tooltip label={t('推理强度：{{label}}{{mappingNote}}', { label, mappingNote })} withArrow>
          {display === 'label' ? (
            <button
              type="button"
              className="yachiyo-composer-reasoning"
              aria-label={String(t('推理强度：{{label}}', { label }))}
              data-mapped={mapping.exact ? 'false' : 'true'}
            >
              <span>{label}</span>
              <IconChevronDown size={13} stroke={2} />
            </button>
          ) : (
            <ActionIcon
              variant="subtle"
              color={mapping.exact ? 'gray' : 'yellow'}
              size={compact ? 28 : 32}
              aria-label={String(t('推理强度'))}
              style={{ flex: '0 0 auto' }}
            >
              <IconBrain size={compact ? 17 : 19} />
            </ActionIcon>
          )}
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown className="yachiyo-composer-popover yachiyo-composer-reasoning-menu" miw={170}>
        <Menu.Label>{t('推理强度')}</Menu.Label>
        {REASONING_STRENGTHS.map((strength) => (
          <Menu.Item
            key={strength}
            onClick={() => onChange(strength)}
            rightSection={value === strength ? <IconCheck size={14} /> : undefined}
          >
            <Text size="sm">{t(LABELS[strength])}</Text>
          </Menu.Item>
        ))}
        <Text size="xs" c="dimmed" px="sm" py={4}>
          {t('部分模型可能使用固定思考模式。')}
        </Text>
      </Menu.Dropdown>
    </Menu>
  )
}
