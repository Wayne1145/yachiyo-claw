/** biome-ignore-all lint/style/noNonNullAssertion: <todo> */
import { SettingsPage, SettingsSection } from '@/components/settings/SettingsPage'
import { Flex, Text } from '@mantine/core'
import { SystemProviders } from '@shared/defaults'
import { IconSelector } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { forwardRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import ModelSelector from '@/components/ModelSelector'
import { enrichModelsFromRegistry, useModelRegistryVersion } from '@/packages/model-registry'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/default-models')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)
  const productCopy = (key: string) => {
    const translated = String(t(key))
    return translated.replaceAll('Chatbox', 'Yachiyo Claw')
  }
  const ocrAutoText = t('None')!

  return (
    <SettingsPage title={t('Default Models')} description={t('聊天、Agent 与辅助任务')}>
      <SettingsSection title={t('Default Chat Model')}>
        <ModelSelector
          position="bottom-start"
          transitionProps={{
            transition: 'fade-down',
            duration: 200,
          }}
          keepMounted
          width={320}
          showAuto={true}
          autoText={t('Auto (Use Last Used)')!}
          selectedProviderId={settings.defaultChatModel?.provider}
          selectedModelId={settings.defaultChatModel?.model}
          searchPosition="top"
          onSelect={(provider, model) => {
            setSettings({
              defaultChatModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }}
        >
          <ModelSelectContent
            autoText={t('Auto (Use Last Used)')!}
            provider={settings.defaultChatModel?.provider}
            model={settings.defaultChatModel?.model}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {productCopy('Chatbox will use this model as the default for new chats.')}
        </Text>
      </SettingsSection>

      <SettingsSection title={t('Default Thread Naming Model')}>
        <ModelSelector
          position="bottom-start"
          width={320}
          showAuto={true}
          autoText={t('Auto (Use Chat Model)')!}
          selectedProviderId={settings.threadNamingModel?.provider}
          selectedModelId={settings.threadNamingModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              threadNamingModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={t('Auto (Use Chat Model)')!}
            provider={settings.threadNamingModel?.provider}
            model={settings.threadNamingModel?.model}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {productCopy('Chatbox will automatically use this model to rename threads.')}
        </Text>
      </SettingsSection>

      <SettingsSection title={t('Search Term Construction Model')}>
        <ModelSelector
          position="bottom-start"
          width={320}
          showAuto={true}
          autoText={t('Auto (Use Chat Model)')!}
          selectedProviderId={settings.searchTermConstructionModel?.provider}
          selectedModelId={settings.searchTermConstructionModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              searchTermConstructionModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={t('Auto (Use Chat Model)')!}
            provider={settings.searchTermConstructionModel?.provider}
            model={settings.searchTermConstructionModel?.model}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {productCopy('Chatbox will automatically use this model to construct search term.')}
        </Text>
      </SettingsSection>
      <SettingsSection title={t('OCR Model')}>
        <ModelSelector
          position="bottom-start"
          showAuto={true}
          autoText={ocrAutoText}
          width={320}
          modelFilter={(model) => model.capabilities?.includes('vision') ?? false}
          selectedProviderId={settings.ocrModel?.provider}
          selectedModelId={settings.ocrModel?.model}
          searchPosition="top"
          onSelect={(provider, model) =>
            setSettings({
              ocrModel:
                provider && model
                  ? {
                      provider,
                      model,
                    }
                  : undefined,
            })
          }
        >
          <ModelSelectContent
            autoText={ocrAutoText}
            provider={settings.ocrModel?.provider}
            model={settings.ocrModel?.model}
          />
        </ModelSelector>

        <Text c="chatbox-tertiary" size="xs">
          {productCopy('Chatbox OCRs images with this model and sends the text to models without image support.')}
        </Text>
      </SettingsSection>
    </SettingsPage>
  )
}

const ModelSelectContent = forwardRef<
  HTMLButtonElement,
  { provider?: string; model?: string; autoText?: string; onClick?: () => void }
>(({ provider, model, autoText, onClick }, ref) => {
  useModelRegistryVersion()

  const { t } = useTranslation()
  const customProviders = useSettingsStore((state) => state.customProviders)
  const providers = useSettingsStore((state) => state.providers)
  const modelOptions = useMemo(() => {
    if (!provider) return []
    const rawModels =
      providers?.[provider]?.models ||
      SystemProviders().find((candidate) => candidate.id === provider)?.defaultSettings?.models ||
      []
    return enrichModelsFromRegistry(rawModels, provider)
  }, [provider, providers])
  const displayText = useMemo(
    () =>
      !provider || !model
        ? autoText || t('Auto')
        : ([...SystemProviders(), ...(customProviders || [])].find((p) => p.id === provider)?.name || provider) +
          '/' +
          (modelOptions.find((candidate) => candidate.modelId === model)?.nickname || model),
    [provider, model, autoText, t, customProviders, modelOptions]
  )
  return (
    <Flex
      ref={ref}
      component="button"
      type="button"
      align="center"
      c="chatbox-tertiary"
      className="settings-model-choice"
      onClick={onClick}
    >
      <Text span flex={1} className=" text-left">
        {displayText}
      </Text>
      <ScalableIcon icon={IconSelector} className=" text-inherit" />
    </Flex>
  )
})
