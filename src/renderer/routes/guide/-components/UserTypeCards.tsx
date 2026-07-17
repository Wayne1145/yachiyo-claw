/**
 * UserTypeCards - Selection cards for user type
 */

import { Box, Flex, Stack, Text, UnstyledButton } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import iconChatbox from '@/static/icons/icon-chatbox.svg'
import iconSkip from '@/static/icons/icon-skip.svg'
import type { UserType } from '../-hooks/useGuideSession'

interface UserTypeCardsProps {
  onSelect: (type: UserType) => void
  disabled?: boolean
}

interface CardConfig {
  type: UserType
  icon: string
  highlighted: boolean
}

const cardConfigs: CardConfig[] = [
  { type: 'novice', icon: iconChatbox, highlighted: true },
  { type: 'expert', icon: iconSkip, highlighted: false },
]

export function UserTypeCards({ onSelect, disabled }: UserTypeCardsProps) {
  const { t } = useTranslation()
  const [selectedType, setSelectedType] = useState<UserType | null>(null)

  const cardTexts = {
    novice: {
      title: t("I'm new to this"),
      description: t('Use Chatbox AI service'),
    },
    expert: {
      title: t('Skip guide'),
      description: t('I know how to configure API keys'),
    },
  } as const

  const handleSelect = (type: UserType) => {
    if (disabled) return
    setSelectedType(type)
    onSelect(type)
  }

  return (
    <Box
      className="grid gap-3 mt-4 mb-2"
      style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}
    >
      {cardConfigs.map(({ type, icon, highlighted }) => {
        const texts = cardTexts[type]
        const isSelected = selectedType === type

        return (
          <UnstyledButton key={type} onClick={() => handleSelect(type)} disabled={disabled} className="h-full">
            <Box
              className={`
                relative h-full rounded-lg overflow-hidden
                transition-all duration-200
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.02]'}
              `}
              style={{
                background: highlighted
                  ? 'linear-gradient(180deg, rgba(34, 139, 230, 0.08) 0%, rgba(34, 139, 230, 0.02) 100%)'
                  : 'linear-gradient(180deg, rgba(134, 142, 150, 0.06) 0%, rgba(134, 142, 150, 0.02) 100%)',
                border: isSelected
                  ? '2px solid var(--chatbox-border-brand)'
                  : highlighted
                    ? '2px solid var(--chatbox-border-brand)'
                    : '2px solid var(--chatbox-border-secondary)',
              }}
            >
              {/* Recommended badge - positioned at top-right corner */}
              {highlighted && (
                <Box
                  className="absolute top-0 right-0 px-3 py-1 text-xs font-medium text-white"
                  style={{
                    background: 'var(--chatbox-background-brand-primary)',
                    borderBottomLeftRadius: '0.5rem',
                  }}
                >
                  {t('Recommended')}
                </Box>
              )}

              {/* Card content - vertical layout */}
              <Stack gap="sm" align="center" className="p-5 pt-8">
                {/* Icon container */}
                <Flex
                  align="center"
                  justify="center"
                  className="w-12 h-12 rounded-full"
                  style={{
                    background: highlighted ? 'rgba(34, 139, 230, 0.12)' : 'rgba(134, 142, 150, 0.12)',
                  }}
                >
                  <img src={icon} alt="" className="w-6 h-6" />
                </Flex>

                {/* Title */}
                <Text
                  fw={600}
                  size="sm"
                  ta="center"
                  className={highlighted ? 'text-chatbox-tint-brand' : 'text-chatbox-tint-primary'}
                >
                  {texts.title}
                </Text>

                {/* Description */}
                <Text size="xs" c="chatbox-secondary" ta="center">
                  {texts.description}
                </Text>
              </Stack>
            </Box>
          </UnstyledButton>
        )
      })}
    </Box>
  )
}
