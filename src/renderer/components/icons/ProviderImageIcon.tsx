/// <reference types="vite/client" />

import { Image } from '@mantine/core'
import { type ModelProvider, ModelProviderEnum } from '@shared/types'
import { useProviders } from '@/hooks/useProviders'
import CustomProviderIcon from '../CustomProviderIcon'
import ProviderIcon from './ProviderIcon'

// Use Vite's import.meta.glob to dynamically import all PNG files
// Vite handles import.meta.glob at build time, even though TypeScript doesn't recognize it with commonjs module setting
// @ts-ignore - import.meta.glob is a Vite feature
const iconsModules = import.meta.glob<{ default: string }>('../../static/icons/providers/*.png', { eager: true })

const icons: { name: string; src: string }[] = Object.entries(iconsModules).map(([path, module]) => {
  const filename = path.split('/').pop() || ''
  const name = filename.replace('.png', '') // 获取图片名称（不含扩展名）
  return {
    name,
    src: (module as { default: string }).default, // 获取图片路径
  }
})

const PROVIDER_ICON_ALIASES: Record<string, string> = {
  [ModelProviderEnum.QwenPortal]: ModelProviderEnum.Qwen,
  [ModelProviderEnum.MiniMaxCN]: ModelProviderEnum.MiniMax,
}

export default function ProviderImageIcon(props: {
  className?: string
  size?: number
  provider: ModelProvider | string
  providerName?: string
}) {
  const { className, size = 24, provider, providerName } = props

  const { providers } = useProviders()
  const providerInfo = providers.find((p) => p.id === provider)

  if (providerInfo?.isCustom) {
    return providerInfo.iconUrl ? (
      <Image w={size} h={size} src={providerInfo.iconUrl} alt={providerInfo.name} />
    ) : (
      <CustomProviderIcon providerId={providerInfo.id} providerName={providerInfo.name} size={size} />
    )
  }

  const iconSrc = icons.find((icon) => icon.name === provider || icon.name === PROVIDER_ICON_ALIASES[provider])?.src

  return iconSrc ? (
    <Image w={size} h={size} src={iconSrc} className={className} alt={`${providerName || provider} image icon`} />
  ) : providerInfo && !providerInfo.isCustom ? (
    <ProviderIcon provider={provider} size={size} className={className} />
  ) : providerName ? (
    <CustomProviderIcon providerId={provider} providerName={providerName} size={size} />
  ) : null
}
