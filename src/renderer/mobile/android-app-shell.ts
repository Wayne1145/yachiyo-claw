import { YACHIYO_API_HOST, YACHIYO_DEFAULT_MODEL, yachiyoProvider } from '@shared/providers/definitions/yachiyo'
import { normalizeYachiyoModels } from '@shared/providers/definitions/yachiyo-models'
import { ModelProviderEnum, type ProviderModelInfo, type Settings } from '@shared/types'
import { registerBuiltinFeatureUi } from '@/features/builtin-feature-ui'
import { registerBuiltinFeatures } from '@/features/builtin-features'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { findFeatureTabForPath, getEnabledTabs, getOwnedRoutes, routeMatchesFeaturePath } from '@/features/ui-registry'
import { settingsStore } from '@/stores/settingsStore'

export const YACHIYO_API_PROVIDER_ID = ModelProviderEnum.Yachiyo
export { YACHIYO_API_HOST as YACHIYO_API_BASE_URL, YACHIYO_DEFAULT_MODEL as YACHIYO_DEFAULT_MODEL_ID }

export type AndroidShellTab = 'chat' | 'settings' | (string & {})
export type AndroidShellWorkspaceView = 'tasks' | 'about' | 'settings' | 'route'
export type AndroidShellBackAction = 'chat' | 'settings' | 'minimize'

type AndroidShellSettings = Pick<Settings, 'customProviders' | 'defaultChatModel' | 'licenseKey' | 'providers'>

function androidFeatureEnvironment(overrides = settingsStore.getState().featureOverrides) {
  return { platform: 'android' as const, enabledFeatureIds: getEnabledFeatureIds('android', overrides) }
}

const CORE_ANDROID_SETTINGS_ROUTES = [
  '/settings/provider',
  '/settings/default-models',
  '/settings/downloads',
  '/settings/themes',
  '/settings/features',
  '/settings/chat',
  '/settings/general',
  '/settings/document-parser',
  '/settings/hotkeys',
  '/settings/plugin-runtime-test',
] as const

export function shouldUseAndroidAppShell(platformType: string, buildPlatform: string): boolean {
  return platformType === 'mobile' && buildPlatform === 'android'
}

export function resolveAndroidShellTab(pathname: string, workspaceTab?: 'tasks'): AndroidShellTab {
  if (workspaceTab) return workspaceTab
  if (pathname === '/about' || pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings'
  registerBuiltinFeatures()
  registerBuiltinFeatureUi()
  return findFeatureTabForPath(pathname, androidFeatureEnvironment())?.id ?? 'chat'
}

export function resolveAndroidShellWorkspaceView(pathname: string, workspaceTab?: 'tasks'): AndroidShellWorkspaceView {
  if (resolveAndroidShellTab(pathname, workspaceTab) === 'tasks') return 'tasks'
  if (pathname === '/about') return 'about'
  if (pathname === '/settings') return 'settings'
  return 'route'
}

export function resolveAndroidShellBackAction(pathname: string): AndroidShellBackAction {
  if (pathname === '/about' || pathname.startsWith('/settings/')) return 'settings'
  if (pathname === '/settings') return 'chat'
  if (pathname.startsWith('/plugin/')) return 'chat'
  registerBuiltinFeatures()
  registerBuiltinFeatureUi()
  const tab = findFeatureTabForPath(pathname, androidFeatureEnvironment())
  if (tab && tab.id !== 'chat') return 'chat'
  return 'minimize'
}

export function resolveAndroidShellParentPath(pathname: string): string | undefined {
  const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const providerDetail = normalizedPath.match(/^\/settings\/provider\/[^/]+(?:\/.*)?$/)
  if (providerDetail) return '/settings/provider'

  const pluginChild = normalizedPath.match(/^\/plugin\/([^/]+)\/.+$/)
  if (pluginChild?.[1]) return `/plugin/${pluginChild[1]}`
  if (/^\/plugin\/[^/]+$/.test(normalizedPath)) return '/settings/plugins'

  if (normalizedPath !== '/settings' && normalizedPath.startsWith('/settings/')) return '/settings'
  if (normalizedPath === '/about') return '/settings'
  return undefined
}

export function isAllowedAndroidShellPath(pathname: string): boolean {
  const corePath =
    pathname === '/' ||
    pathname === '/about' ||
    pathname === '/task' ||
    pathname.startsWith('/task/') ||
    pathname.startsWith('/session/') ||
    pathname === '/settings' ||
    CORE_ANDROID_SETTINGS_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  if (corePath) return true
  registerBuiltinFeatures()
  registerBuiltinFeatureUi()
  return getOwnedRoutes(androidFeatureEnvironment()).some((route) => routeMatchesFeaturePath(pathname, route))
}

export function getAndroidShellTabs(overrides?: Readonly<Record<string, boolean>>) {
  registerBuiltinFeatures()
  registerBuiltinFeatureUi()
  return getEnabledTabs(androidFeatureEnvironment(overrides))
}

export function hasConfiguredModelProvider(
  settings: Pick<Settings, 'customProviders' | 'licenseKey' | 'providers'>,
): boolean {
  if (settings.licenseKey?.trim()) return true
  const customProviderIds = new Set(settings.customProviders?.map((provider) => provider.id) || [])

  return Object.entries(settings.providers || {}).some(([providerId, provider]) => {
    if (customProviderIds.has(providerId)) return Boolean(provider.models?.length)
    if (provider.apiKey?.trim() || provider.oauth?.accessToken?.trim()) return true
    if (provider.accessKey?.trim() && provider.secretKey?.trim()) return true
    return (
      (providerId === ModelProviderEnum.Local ||
        providerId === ModelProviderEnum.Ollama ||
        providerId === ModelProviderEnum.LMStudio) &&
      Boolean(provider.models?.length)
    )
  })
}

export function hasYachiyoDefaultModel(models: ProviderModelInfo[]): boolean {
  return models.some((model) => model.modelId === YACHIYO_DEFAULT_MODEL)
}

export function createYachiyoApiSettingsPatch(
  settings: AndroidShellSettings,
  apiKey: string,
  models?: ProviderModelInfo[],
): Partial<Settings> {
  const normalizedApiKey = apiKey.trim()
  if (!normalizedApiKey) {
    throw new Error('api_key_required')
  }

  const existingSettings = settings.providers?.[ModelProviderEnum.Yachiyo]
  const providerModels =
    models &&
    normalizeYachiyoModels(models).map((model) => {
      const defaultModel = yachiyoProvider.defaultSettings?.models?.find(
        (candidate) => candidate.modelId === model.modelId,
      )
      return defaultModel ? { ...defaultModel, ...model } : model
    })

  return {
    providers: {
      ...(settings.providers || {}),
      [ModelProviderEnum.Yachiyo]: {
        ...existingSettings,
        apiKey: normalizedApiKey,
        apiHost: YACHIYO_API_HOST,
        apiPath: '/chat/completions',
        activeAuthMode: 'apikey',
        ...(providerModels ? { models: providerModels } : {}),
      },
    },
    defaultChatModel: {
      provider: ModelProviderEnum.Yachiyo,
      model: YACHIYO_DEFAULT_MODEL,
    },
  }
}
