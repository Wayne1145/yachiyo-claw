import type { ModelProvider, ProviderBaseInfo, ProviderModelInfo, ProviderSettings, SessionType } from '@shared/types'

export interface ModelSettingUtil {
  provider: ModelProvider
  // 用在消息下面展示的模型名称
  getCurrentModelDisplayName(
    model: string,
    sessionType: SessionType,
    providerSettings?: ProviderSettings,
    providerBaseInfo?: ProviderBaseInfo
  ): Promise<string>
  // 获取该provider远程的模型组
  getMergeOptionGroups(providerSettings: ProviderSettings): Promise<ProviderModelInfo[]>
}
