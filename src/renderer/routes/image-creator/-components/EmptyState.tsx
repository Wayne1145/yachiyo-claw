import { Flex, Text, UnstyledButton } from '@mantine/core'
import { IconPhoto } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

export interface EmptyStateProps {
  onPromptSelect: (prompt: string) => void
}

export function EmptyState({ onPromptSelect }: EmptyStateProps) {
  const { t } = useTranslation()

  const quickPrompts = [
    t('A serene mountain landscape at sunset'),
    t('A futuristic city with flying cars'),
    t('A cozy coffee shop interior'),
    t('An abstract painting with vibrant colors'),
    t('A cute rabbit in Pixar animation style'),
  ]

  return (
    <Flex direction="column" align="center" justify="center" className="min-h-[60vh]">
      {/* Simple Icon */}
      <div className="w-20 h-20 rounded-2xl bg-[var(--chatbox-background-secondary)] flex items-center justify-center mb-6">
        <IconPhoto size={40} className="text-[var(--chatbox-tint-tertiary)]" stroke={1.5} />
      </div>

      <Text size="xl" fw={600} mb="xs" className="text-center">
        {t('Create amazing images')}
      </Text>
      <Text size="sm" c="dimmed" maw={420} className="text-center" mb="xl">
        {t('Describe the image you want to generate. Be as detailed as possible for best results.')}
      </Text>

      {/* Quick Prompts - Grid Layout */}
      <Flex gap="sm" wrap="wrap" justify="center" maw={600}>
        {quickPrompts.map((promptText) => (
          <UnstyledButton
            key={promptText}
            onClick={() => onPromptSelect(promptText)}
            className="px-4 py-3 rounded-xl bg-[var(--chatbox-background-secondary)] hover:bg-[var(--chatbox-background-tertiary)] transition-colors duration-200"
            style={{ maxWidth: 280 }}
          >
            <Text size="sm" ta="center">
              {promptText}
            </Text>
          </UnstyledButton>
        ))}
      </Flex>
    </Flex>
  )
}
