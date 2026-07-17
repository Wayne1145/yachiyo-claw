import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Stack, Text } from '@mantine/core'
import { IconStarFilled, IconThumbUpFilled } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { recordAppStoreRatingClick } from '@/packages/apple_app_store'
import platform from '@/platform'

const AppStoreRating = NiceModal.create(() => {
  const { t } = useTranslation()
  const modal = useModal()

  const handleRateNow = async () => {
    const appStoreUrl = 'itms-apps://itunes.apple.com/app/id6471368056?action=write-review'
    try {
      platform.openLink(appStoreUrl)
    } catch (error) {
      console.error('Failed to open App Store:', error)
    }
    modal.resolve()
    modal.hide()
    await recordAppStoreRatingClick()
  }
  const onClose = () => {
    modal.resolve()
    modal.hide()
  }

  return (
    <AdaptiveModal opened={modal.visible} onClose={onClose} centered>
      <Stack align="center">
        <ScalableIcon icon={IconThumbUpFilled} size={64} color="var(--chatbox-tint-success)" />
        <Text size="xl" fw={600} className="text-center">
          {t('Enjoying Chatbox?')}
        </Text>
        <Text size="md" c="chatbox-secondary" className="text-center">
          {t('Your rating on the App Store would help make Chatbox even better!')}
        </Text>
        <Text size="sm" c="chatbox-tertiary" className="text-center">
          {t('It only takes a few seconds and helps a lot.')}
        </Text>

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onClose}>{t('Maybe Later')}</AdaptiveModal.CloseButton>
          <Button
            onClick={handleRateNow}
            color="chatbox-success"
            rightSection={<ScalableIcon icon={IconStarFilled} size={16} />}
          >
            {t('Rate Now')}
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
})

export default AppStoreRating
