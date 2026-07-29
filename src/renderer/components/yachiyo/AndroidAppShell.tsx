import { App } from '@capacitor/app'
import { ActionIcon, Menu } from '@mantine/core'
import {
  IconBolt,
  IconChevronLeft,
  IconChevronUp,
  IconDots,
  IconHistory,
  IconMessagePlus,
  IconPuzzle,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react'
import { useLocation } from '@tanstack/react-router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { copyAgentSessionConfig, saveAgentSessionConfig } from '@/mobile/agent-session-config'
import {
  type AndroidShellTab,
  createYachiyoApiSettingsPatch,
  getAndroidShellTabs,
  hasConfiguredModelProvider,
  hasYachiyoDefaultModel,
  isAllowedAndroidShellPath,
  resolveAndroidShellBackAction,
  resolveAndroidShellParentPath,
  resolveAndroidShellTab,
  resolveAndroidShellWorkspaceView,
} from '@/mobile/android-app-shell'
import { getOverlays } from '@/features/ui-registry'
import { registerBuiltinFeatureOverlays } from '@/features/builtin-overlays'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { ensureAgentTaskForChat, ensureChatSessionForTask } from '@/mobile/conversation-bridge'
import { removeBuiltInDemoSessions } from '@/mobile/demo-session-cleanup'
import { syncInstalledLocalModelsIntoSettings } from '@/mobile/local-model-provider-sync'
import { fetchYachiyoModels } from '@/mobile/yachiyo-api'
import { yachiyoDownloadsNative } from '@/platform/native/yachiyo_downloads'
import {
  type AndroidInteractionState,
  getAndroidInteractionState,
  onAndroidInteractionStateChanged,
  syncAndroidSystemBars,
} from '@/platform/native/yachiyo_appearance'
import { router } from '@/router'
import { initThemeApplication } from '@/stores/themeStore'
import { useUIStore } from '@/stores/uiStore'
import { LIQUID_GLASS_QUALITY_STORAGE_KEY, observeLiquidGlassQuality } from '@/themes/liquid-glass-quality'
import { initPluginTools, usePluginStore } from '@/plugins/plugin-manager'
import { PluginPageHost } from '@/plugins/PluginPageHost'
import { startPendingPluginInstallRecovery } from '@/plugins/install-recovery'
import { startPendingThemeImportRecovery } from '@/themes/remote-theme'
import { pruneAbandonedEmptySessions, useSession } from '@/stores/chatStore'
import { createEmpty, switchCurrentSession } from '@/stores/sessionActions'
import { persistSettingsPatch, useSettingsStore } from '@/stores/settingsStore'
import { getTaskSession, listAllTaskSessions, taskSessionStore, useTaskSessionRecord } from '@/stores/taskSessionStore'
import { AgentSessionControls, describeAgentMode } from './AgentSessionControls'
import { AdaptiveActionCluster, type AdaptiveActionDescriptor } from './AdaptiveActionCluster'
import { AndroidAppShellContext } from './AndroidAppShellContext'
import { AndroidConversationHistory } from './AndroidConversationHistory'
import { AndroidInteractive } from './AndroidInteractive'
import { AndroidMainTabPager, type AndroidTabTransitionSnapshot } from './AndroidMainTabPager'
import { AndroidPagerHeaderActions, AndroidPagerHeaderTitle } from './AndroidPagerHeaderTransition'
import { AndroidRetainedTabSurface } from './android-retained-state'
import { AndroidPagerGestureLockProvider } from './android-pager-gesture-lock'
import { AndroidSharedChromeHostProvider, AndroidStandardChromeLayer } from './AndroidSharedChrome'
import { AndroidSettingsHome } from './AndroidSettingsHome'
import { AndroidSettingsChromeTransition, AndroidSettingsStackSurface } from './AndroidSettingsStackSurface'
import { AndroidTabPagePreview } from './AndroidTabPagePreview'
import { AndroidAboutWorkspace, AndroidTasksWorkspace } from './AndroidWorkspaceHome'
import { YachiyoApiOnboarding } from './YachiyoApiOnboarding'
import { YachiyoChatLanding } from './YachiyoChatLanding'
import { YachiyoMark } from './YachiyoMark'
import { AndroidFlowGlassEnvironment, FlowGlassFilterDefinitions } from './AndroidFlowGlassEnvironment'
import type { AndroidTabPageActivity } from './android-tab-page-activity'
import './android-app-shell.css'
import './flow-glass.css'
import './local-model-center.css'

const SETTINGS_HEADER_TITLES: Readonly<Record<string, string>> = {
  provider: 'Model Provider',
  'default-models': 'Default Models',
  downloads: '下载管理',
  themes: '主题外观',
  features: '功能管理',
  chat: 'Chat Settings',
  general: 'General Settings',
  'document-parser': 'Document Parser',
  hotkeys: 'Keyboard Shortcuts',
  plugins: '插件',
  'local-models': '本地模型',
  mcp: 'MCP',
  'knowledge-base': '知识库',
  skills: 'Skills',
  speech: '语音',
  'web-search': 'Web Search',
  'user-memory': '用户记忆',
  characters: '角色',
  'plugin-runtime-test': '插件运行时测试',
}

function resolveSettingsHeaderTitle(pathname: string, translate: (key: string) => string): string {
  if (pathname === '/settings') return 'Yachiyo Claw'
  if (pathname === '/about') return translate('About')
  const section = pathname.split('/').filter(Boolean)[1]
  return translate((section && SETTINGS_HEADER_TITLES[section]) || 'Settings')
}

export function AndroidAppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const location = useLocation()
  const lastConversationPathname = useRef(
    location.pathname === '/' || location.pathname.startsWith('/session/') || location.pathname.startsWith('/task/')
      ? location.pathname
      : '/',
  )
  const lastTabLocation = useRef(new Map<AndroidShellTab, { pathname: string; search: Record<string, unknown> }>())
  const tabNavigationTransactionRef = useRef(0)
  const [historyOpened, setHistoryOpened] = useState(false)
  const [conversationHeaderCollapsed, setConversationHeaderCollapsed] = useState(false)
  const reduceMotion = useReducedMotion()
  const [pagerTransition, setPagerTransition] = useState<AndroidTabTransitionSnapshot>()
  const [sharedChromeHost, setSharedChromeHost] = useState<HTMLElement | null>(null)
  const [interactionState, setInteractionState] = useState<AndroidInteractionState>({
    navigationMode: 'unknown',
    systemGestureInsetsCssPx: { left: 0, right: 0 },
    touchExplorationEnabled: false,
  })
  const customProviders = useSettingsStore((state) => state.customProviders)
  const defaultChatModel = useSettingsStore((state) => state.defaultChatModel)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const providers = useSettingsStore((state) => state.providers)
  const featureOverrides = useSettingsStore((state) => state.featureOverrides)
  const setOpenSearchDialog = useUIStore((state) => state.setOpenSearchDialog)
  const realTheme = useUIStore((state) => state.realTheme)
  const installedPlugins = usePluginStore((state) => state.installed)
  const contributionPluginIds = usePluginStore((state) => state.contributionPluginIds)
  const settings = useMemo(
    () => ({ customProviders, defaultChatModel, licenseKey, providers }),
    [customProviders, defaultChatModel, licenseKey, providers],
  )
  const hasProvider = useMemo(() => hasConfiguredModelProvider(settings), [settings])
  const enabledFeatureIds = useMemo(() => getEnabledFeatureIds('android', featureOverrides), [featureOverrides])
  const shellTabs = useMemo(() => {
    const core = getAndroidShellTabs(featureOverrides)
    const allowedContributions = new Set(contributionPluginIds)
    const pluginTabs = (enabledFeatureIds.has('plugins') ? installedPlugins : [])
      .filter((record) => allowedContributions.has(record.manifest.id) && record.manifest.contributions.tab)
      .map((record) => ({
        id: `plugin-${record.manifest.id}`,
        label: record.manifest.contributions.tab?.label ?? record.manifest.displayName,
        icon: IconPuzzle,
        order: record.manifest.contributions.tab?.order ?? 900,
        route: record.manifest.contributions.tab?.route ?? `/plugin/${record.manifest.id}`,
      }))
      .sort((a, b) => a.order - b.order)
    // Android's stable bottom bar supports five destinations; remaining plugin pages stay available
    // from their settings contributions and the plugin center.
    const availablePluginSlots = Math.max(0, 5 - core.length)
    return [...core, ...pluginTabs.slice(0, availablePluginSlots)].sort((a, b) => a.order - b.order)
  }, [contributionPluginIds, enabledFeatureIds, featureOverrides, installedPlugins])
  const shellOverlays = useMemo(() => {
    registerBuiltinFeatureOverlays()
    return getOverlays({ platform: 'android', enabledFeatureIds })
  }, [enabledFeatureIds])
  const activePlugin = installedPlugins.find(
    (record) =>
      location.pathname === `/plugin/${record.manifest.id}` ||
      location.pathname.startsWith(`/plugin/${record.manifest.id}/`),
  )
  const activeTab = activePlugin ? `plugin-${activePlugin.manifest.id}` : resolveAndroidShellTab(location.pathname)
  const activeTabLabel = t(
    shellTabs.find((tab) => tab.id === activeTab)?.label ?? activePlugin?.manifest.displayName ?? '聊天',
  )
  const pagerTarget = pagerTransition ? shellTabs.find((tab) => tab.id === pagerTransition.targetId) : undefined
  const pagerTargetLabel = String(t(pagerTarget?.label ?? activeTabLabel))
  const pagerTargetPath = pagerTarget
    ? (lastTabLocation.current.get(pagerTarget.id)?.pathname ?? pagerTarget.route)
    : undefined
  const workspaceView = resolveAndroidShellWorkspaceView(location.pathname)
  const isAllowedPath = isAllowedAndroidShellPath(location.pathname)
  const isAgentTaskPath = location.pathname === '/task' || location.pathname.startsWith('/task/')
  const isSettingsDetail = activeTab === 'settings' && location.pathname !== '/settings'
  const isInteractive = activeTab === 'interactive'
  const settingsHeaderTitle = resolveSettingsHeaderTitle(location.pathname, (key) => String(t(key)))

  useLayoutEffect(() => {
    // Apply persisted theme tokens before the shell is painted to avoid a default-color flash.
    initThemeApplication()
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem(LIQUID_GLASS_QUALITY_STORAGE_KEY)
    const preference =
      stored === 'full' || stored === 'balanced' || stored === 'reduced' || stored === 'auto' ? stored : 'auto'
    return observeLiquidGlassQuality(preference)
  }, [])

  useEffect(() => {
    void syncAndroidSystemBars({ scheme: realTheme })
      .then(setInteractionState)
      .catch(() => undefined)
  }, [realTheme])

  useEffect(() => {
    let disposed = false
    let listenerHandle: Awaited<ReturnType<typeof onAndroidInteractionStateChanged>> | undefined
    void getAndroidInteractionState()
      .then((state) => {
        if (!disposed) setInteractionState(state)
      })
      .catch(() => undefined)
    void onAndroidInteractionStateChanged((state) => {
      if (!disposed) setInteractionState(state)
    }).then((handle) => {
      if (disposed) void handle.remove()
      else listenerHandle = handle
    })
    return () => {
      disposed = true
      if (listenerHandle) void listenerHandle.remove()
    }
  }, [])

  useEffect(() => {
    // Configure regional download defaults once. Failure is intentionally silent and retried at
    // the next launch; explicit settings saved by the user are never overwritten.
    void yachiyoDownloadsNative.initializeRegionalDefaults().catch(() => undefined)
  }, [])

  useEffect(() => {
    // Register installed plugins' tools into the Agent toolset registry (grant-gated per session build).
    initPluginTools()
    void usePluginStore.getState().refresh()
    return startPendingPluginInstallRecovery(() => {
      void router.navigate({ to: '/settings/plugins' })
    })
  }, [])

  useEffect(
    () =>
      startPendingThemeImportRecovery(() => {
        void router.navigate({ to: '/settings/themes' })
      }),
    [],
  )

  useEffect(() => {
    void syncInstalledLocalModelsIntoSettings().catch(() => undefined)
  }, [])

  useEffect(() => {
    // New sessions are only drafts until the user sends content. Clear stale startup drafts once,
    // protecting any session a scheduled task is linked to (starred/branch sessions are kept by the store).
    void (async () => {
      try {
        const tasks = await listAllTaskSessions()
        const protectedIds = new Set(
          tasks.map((task) => task.linkedSessionId).filter((id): id is string => Boolean(id)),
        )
        await pruneAbandonedEmptySessions(60_000, protectedIds)
      } catch {
        // Fall back to the default prune if the task index is unavailable.
        await pruneAbandonedEmptySessions().catch(() => undefined)
      }
    })()
  }, [])

  useEffect(() => {
    // A download notification tap sets a pending route natively; pick it up on launch and on resume.
    const consumePendingRoute = async () => {
      try {
        const { route } = await yachiyoDownloadsNative.consumePendingRoute()
        if (route === 'downloads') void router.navigate({ to: '/settings/downloads' })
      } catch {
        // No native pending route (e.g. non-Android platform); nothing to do.
      }
    }
    void consumePendingRoute()
    const handles: Array<{ remove: () => Promise<void> }> = []
    void App.addListener('resume', () => void consumePendingRoute()).then((handle) => handles.push(handle))
    void yachiyoDownloadsNative
      .addListener('route', ({ route }) => {
        if (route === 'downloads') {
          void yachiyoDownloadsNative.consumePendingRoute().catch(() => undefined)
          void router.navigate({ to: '/settings/downloads' })
        }
      })
      .then((handle) => handles.push(handle))
    return () => handles.forEach((handle) => void handle.remove())
  }, [])

  useEffect(() => {
    if (location.pathname === '/' || location.pathname.startsWith('/session/')) {
      lastConversationPathname.current = location.pathname
    } else if (location.pathname.startsWith('/task/')) {
      lastConversationPathname.current = location.pathname
    }
  }, [location.pathname])

  useEffect(() => {
    lastTabLocation.current.set(activeTab, {
      pathname: location.pathname,
      search: location.search as Record<string, unknown>,
    })
  }, [activeTab, location.pathname, location.search])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => Promise<void>) | undefined

    void App.addListener('backButton', async () => {
      if (historyOpened) {
        setHistoryOpened(false)
        return
      }

      const parentPath = resolveAndroidShellParentPath(location.pathname)
      if (parentPath) {
        await router.navigate({ to: parentPath as '/', search: {}, replace: true })
        return
      }

      const action = resolveAndroidShellBackAction(location.pathname)
      if (action === 'settings') {
        await router.navigate({ to: '/settings', replace: true })
        return
      }
      if (action === 'chat') {
        const savedTaskMatch = lastConversationPathname.current.match(/^\/task\/([^/]+)$/)
        if (savedTaskMatch?.[1]) {
          await router.navigate({
            to: '/task/$taskId',
            params: { taskId: savedTaskMatch[1] },
            replace: true,
          })
          return
        }
        const savedChatMatch = lastConversationPathname.current.match(/^\/session\/([^/]+)$/)
        if (savedChatMatch?.[1]) {
          await router.navigate({
            to: '/session/$sessionId',
            params: { sessionId: savedChatMatch[1] },
            replace: true,
          })
        } else {
          await router.navigate({ to: '/', replace: true })
        }
        return
      }
      await App.minimizeApp()
    }).then((handle) => {
      if (disposed) void handle.remove()
      else removeListener = handle.remove
    })

    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [historyOpened, location.pathname])

  useEffect(() => {
    void removeBuiltInDemoSessions()
  }, [])

  useEffect(() => {
    if (location.pathname.includes('chatbox-ai')) {
      void router.navigate({ to: '/settings', replace: true })
      return
    }
    if (!isAllowedPath) {
      void router.navigate({ to: '/', replace: true })
    }
  }, [isAllowedPath, location.pathname])

  const handleTabChange = async (tab: AndroidShellTab) => {
    const transactionId = ++tabNavigationTransactionRef.current
    const isCurrentTransaction = () => transactionId === tabNavigationTransactionRef.current
    const taskMatch = location.pathname.match(/^\/task\/([^/]+)$/)
    const savedLocation = lastTabLocation.current.get(tab)

    if (tab === 'interactive') {
      const savedSessionId = savedLocation?.search.sessionId
      if (typeof savedSessionId === 'string') {
        await router.navigate({ to: '/interactive', search: { sessionId: savedSessionId }, replace: true })
        return
      }
      let sessionId = location.pathname.match(/^\/session\/([^/]+)$/)?.[1]
      if (!sessionId && taskMatch?.[1]) {
        sessionId = await ensureChatSessionForTask(taskMatch[1])
        if (!isCurrentTransaction()) return
      }
      if (!sessionId) {
        const savedChatMatch = lastConversationPathname.current.match(/^\/session\/([^/]+)$/)
        const savedTaskMatch = lastConversationPathname.current.match(/^\/task\/([^/]+)$/)
        sessionId = savedChatMatch?.[1]
        if (!sessionId && savedTaskMatch?.[1]) {
          sessionId = await ensureChatSessionForTask(savedTaskMatch[1])
          if (!isCurrentTransaction()) return
        }
      }
      if (!sessionId) {
        sessionId = (await createEmpty('chat')).id
        if (!isCurrentTransaction()) return
      }
      if (!isCurrentTransaction()) return
      await router.navigate({ to: '/interactive', search: { sessionId }, replace: true })
      return
    }

    if (tab !== 'chat') {
      if (savedLocation) {
        await router.navigate({
          to: savedLocation.pathname as '/',
          search: savedLocation.search as never,
          replace: true,
        })
        return
      }
      const destination = shellTabs.find((candidate) => candidate.id === tab)
      if (destination) await router.navigate({ to: destination.route as '/', replace: true })
      return
    }
    if (taskMatch?.[1]) {
      const sessionId = await ensureChatSessionForTask(taskMatch[1])
      if (!isCurrentTransaction()) return
      copyAgentSessionConfig(taskMatch[1], sessionId)
      saveAgentSessionConfig(sessionId, { enabled: false, allowDangerousForConversation: false })
      switchCurrentSession(sessionId)
      return
    }
    if (location.pathname === lastConversationPathname.current) return
    const savedTaskMatch = lastConversationPathname.current.match(/^\/task\/([^/]+)$/)
    if (savedTaskMatch?.[1]) {
      await router.navigate({
        to: '/task/$taskId',
        params: { taskId: savedTaskMatch[1] },
        replace: true,
      })
      return
    }
    const savedChatMatch = lastConversationPathname.current.match(/^\/session\/([^/]+)$/)
    if (savedChatMatch?.[1]) {
      await router.navigate({
        to: '/session/$sessionId',
        params: { sessionId: savedChatMatch[1] },
        replace: true,
      })
      return
    }
    await router.navigate({ to: '/', replace: true })
  }

  const chatMatch = location.pathname.match(/^\/session\/([^/]+)$/)
  const taskMatch = location.pathname.match(/^\/task\/([^/]+)$/)
  const conversationConfigId = taskMatch?.[1] || chatMatch?.[1] || 'new'
  const { session: headerChatSession } = useSession(chatMatch?.[1] || null)
  const { data: headerTaskSession } = useTaskSessionRecord(taskMatch?.[1] || null)
  const conversationTitle = headerTaskSession?.name || headerChatSession?.name
  const toolbarSessionId = chatMatch?.[1] || headerTaskSession?.linkedSessionId
  const showConversationTools = activeTab === 'chat'
  const interactiveSearch = location.search as Record<string, unknown>
  const interactiveSessionId = typeof interactiveSearch.sessionId === 'string' ? interactiveSearch.sessionId : undefined

  const headerActions = useMemo<AdaptiveActionDescriptor[]>(() => {
    if (!showConversationTools) return []
    return [
      {
        id: 'search',
        label: String(t('Search')),
        icon: IconSearch,
        priority: 40,
        collapseStrategy: 'keep',
        renderControl: () => (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={44}
            aria-label={String(t('Search'))}
            onClick={() => setOpenSearchDialog(true, !toolbarSessionId)}
          >
            <IconSearch size={20} />
          </ActionIcon>
        ),
      },
      {
        id: 'history',
        label: String(t('会话记录')),
        icon: IconHistory,
        priority: 100,
        collapseStrategy: 'keep',
        renderControl: () => (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={44}
            aria-label={String(t('会话记录'))}
            onClick={() => setHistoryOpened(true)}
          >
            <IconHistory size={21} />
          </ActionIcon>
        ),
      },
      {
        id: 'new-topic',
        label: String(t('New Thread')),
        icon: IconMessagePlus,
        priority: 120,
        collapseStrategy: 'keep',
        renderControl: () => (
          <ActionIcon
            className="yachiyo-mobile-header-new-topic"
            variant="subtle"
            color="gray"
            size={44}
            aria-label={String(t('New Thread'))}
            onClick={() => {
              void createEmpty('chat').then(async (session) => {
                switchCurrentSession(session.id)
                await router.navigate({ to: '/session/$sessionId', params: { sessionId: session.id } })
              })
            }}
          >
            <IconMessagePlus size={22} />
          </ActionIcon>
        ),
      },
      {
        id: 'more',
        label: String(t('More')),
        icon: IconDots,
        priority: 130,
        collapseStrategy: 'keep',
        renderControl: () => (
          <Menu position="bottom-end" withinPortal shadow="md">
            <Menu.Target>
              <ActionIcon
                className="yachiyo-mobile-header-more"
                variant="subtle"
                color="gray"
                size={44}
                aria-label={String(t('More'))}
              >
                <IconDots size={21} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown className="yachiyo-header-more-menu">
              <Menu.Item
                leftSection={<IconSettings size={18} />}
                onClick={() => void router.navigate({ to: '/settings/chat', search: {} })}
              >
                {t('Chat Settings')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ),
      },
    ]
  }, [setOpenSearchDialog, showConversationTools, t, toolbarSessionId])

  const handleAgentToggle = async (enabled: boolean) => {
    if (enabled) {
      let chatSessionId = chatMatch?.[1]
      if (!chatSessionId) {
        const session = await createEmpty('chat')
        chatSessionId = session.id
        copyAgentSessionConfig('new', session.id)
      }
      const task = await ensureAgentTaskForChat(chatSessionId)
      copyAgentSessionConfig(chatSessionId, task.id)
      saveAgentSessionConfig(task.id, { enabled: true, configured: true })
      taskSessionStore.getState().setCurrentTaskId(task.id)
      await router.navigate({ to: '/task/$taskId', params: { taskId: task.id } })
      return
    }

    if (!taskMatch?.[1]) return
    const task = await getTaskSession(taskMatch[1])
    const sessionId = await ensureChatSessionForTask(taskMatch[1])
    copyAgentSessionConfig(taskMatch[1], sessionId)
    saveAgentSessionConfig(sessionId, { enabled: false, allowDangerousForConversation: false })
    if (task?.linkedSessionId) switchCurrentSession(task.linkedSessionId)
    else switchCurrentSession(sessionId)
  }

  const handleApiKeySubmit = async (apiKey: string) => {
    const models = await fetchYachiyoModels(apiKey)
    if (!hasYachiyoDefaultModel(models)) {
      throw new Error('yachiyo_default_model_unavailable')
    }
    try {
      // This resolves only after the Android Keystore-backed storage adapter has committed the settings row.
      await persistSettingsPatch(createYachiyoApiSettingsPatch(settings, apiKey, models))
    } catch {
      throw new Error('settings_persist_failed')
    }
  }

  const renderTabPreview = (tab: AndroidShellTab) => {
    const descriptor = shellTabs.find((candidate) => candidate.id === tab)
    return (
      <AndroidTabPagePreview
        tab={tab}
        savedLocation={lastTabLocation.current.get(tab)}
        fallbackRoute={descriptor?.route || '/'}
      />
    )
  }

  const content = (() => {
    if (workspaceView === 'tasks') return <AndroidTasksWorkspace />
    if (activeTab === 'settings') {
      const settingsPage =
        workspaceView === 'settings' ? (
          <AndroidSettingsHome />
        ) : workspaceView === 'about' ? (
          <AndroidAboutWorkspace />
        ) : (
          <div className="yachiyo-settings-detail">{children}</div>
        )
      return <AndroidSettingsStackSurface pathname={location.pathname}>{settingsPage}</AndroidSettingsStackSurface>
    }
    if (isAgentTaskPath) return children
    if (activeTab === 'chat' && (!hasProvider || location.pathname === '/guide')) {
      return (
        <YachiyoApiOnboarding
          onSubmit={handleApiKeySubmit}
          onOpenProviders={() => void router.navigate({ to: '/settings/provider' })}
        />
      )
    }
    if (!isAllowedPath) return <YachiyoChatLanding />
    return children
  })()

  const renderSourceContent = (activity: AndroidTabPageActivity) => {
    if (activeTab === 'interactive') {
      return (
        <AndroidInteractive
          sessionId={interactiveSessionId}
          onSessionChange={(sessionId) =>
            void router.navigate({ to: '/interactive', search: { sessionId }, replace: true })
          }
          activity={activity}
        />
      )
    }
    if (activeTab.startsWith('plugin-')) {
      return <PluginPageHost pluginId={activeTab.slice('plugin-'.length)} activity={activity} />
    }
    return (
      <AndroidRetainedTabSurface stateKey={`${activeTab}:${location.pathname}:${JSON.stringify(location.search)}`}>
        {content}
      </AndroidRetainedTabSurface>
    )
  }
  const standardHeaderTransition = pagerTransition?.targetId === 'interactive' ? undefined : pagerTransition

  return (
    <AndroidAppShellContext.Provider value={true}>
      <AndroidPagerGestureLockProvider>
        <AndroidSharedChromeHostProvider host={sharedChromeHost}>
          <div className="yachiyo-mobile-shell">
            <AndroidFlowGlassEnvironment pathname={location.pathname} />
            {pagerTransition && pagerTargetPath && (
              <AndroidFlowGlassEnvironment pathname={pagerTargetPath} transitionOpacity={pagerTransition.progress} />
            )}
            <FlowGlassFilterDefinitions />
            {shellOverlays.map((Overlay, index) => (
              <Overlay key={`${Overlay.displayName || Overlay.name || 'feature-overlay'}-${index}`} />
            ))}
            <AndroidConversationHistory
              opened={historyOpened}
              mode={isAgentTaskPath ? 'agent' : 'chat'}
              currentId={location.pathname.split('/').at(-1)}
              onClose={() => setHistoryOpened(false)}
            />
            <div className="yachiyo-mobile-header-drawer">
              <div className="yachiyo-mobile-header-drawer-inner">
                <header className="yachiyo-mobile-header">
                  <div className="yachiyo-mobile-header-primary">
                    <AndroidStandardChromeLayer activeInteractive={isInteractive} transition={pagerTransition}>
                      {activeTab === 'settings' ? (
                        <AndroidSettingsChromeTransition
                          pathname={location.pathname}
                          className="yachiyo-settings-chrome-leading"
                        >
                          {isSettingsDetail ? (
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              size={44}
                              aria-label={String(t('返回设置'))}
                              onClick={() =>
                                router.navigate({
                                  to: (resolveAndroidShellParentPath(location.pathname) || '/settings') as '/',
                                  search: {},
                                })
                              }
                            >
                              <IconChevronLeft size={22} />
                            </ActionIcon>
                          ) : (
                            <YachiyoMark size={36} />
                          )}
                        </AndroidSettingsChromeTransition>
                      ) : (
                        <YachiyoMark size={36} />
                      )}
                      {activeTab === 'settings' ? (
                        <AndroidSettingsChromeTransition
                          pathname={location.pathname}
                          className="yachiyo-settings-chrome-title"
                        >
                          <AndroidPagerHeaderTitle
                            title={settingsHeaderTitle}
                            subtitle={String(t('Settings'))}
                            targetTitle="Yachiyo Claw"
                            targetSubtitle={pagerTargetLabel}
                            connected={hasProvider}
                            transition={standardHeaderTransition}
                          />
                        </AndroidSettingsChromeTransition>
                      ) : (
                        <AndroidPagerHeaderTitle
                          title={conversationTitle || 'Yachiyo Claw'}
                          subtitle={String(isAgentTaskPath ? t('Agent 对话') : activeTabLabel)}
                          targetTitle="Yachiyo Claw"
                          targetSubtitle={pagerTargetLabel}
                          connected={hasProvider}
                          transition={standardHeaderTransition}
                        />
                      )}
                      {headerActions.length > 0 && (
                        <AndroidPagerHeaderActions transition={standardHeaderTransition}>
                          <AdaptiveActionCluster
                            className="yachiyo-mobile-conversation-tools"
                            ariaLabel={String(t('会话操作'))}
                            actions={headerActions}
                          />
                        </AndroidPagerHeaderActions>
                      )}
                    </AndroidStandardChromeLayer>
                    <div
                      ref={setSharedChromeHost}
                      className="yachiyo-shared-interactive-chrome-host"
                      aria-live="polite"
                    />
                  </div>
                  {activeTab === 'chat' && (
                    <div className="yachiyo-agent-disclosure" data-collapsed={conversationHeaderCollapsed || undefined}>
                      <button
                        type="button"
                        className="yachiyo-agent-disclosure-trigger"
                        aria-expanded={!conversationHeaderCollapsed}
                        onClick={() => setConversationHeaderCollapsed((value) => !value)}
                      >
                        <IconBolt size={18} aria-hidden />
                        <span>{describeAgentMode(conversationConfigId, isAgentTaskPath, (key) => String(t(key)))}</span>
                        <motion.span
                          className="yachiyo-mobile-header-collapse-glyph"
                          aria-hidden="true"
                          animate={{ rotate: conversationHeaderCollapsed ? 180 : 0 }}
                          transition={
                            reduceMotion
                              ? { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }
                              : { type: 'spring', mass: 1, stiffness: 420, damping: 40 }
                          }
                        >
                          <IconChevronUp size={18} />
                        </motion.span>
                      </button>
                      <AnimatePresence initial={false}>
                        {!conversationHeaderCollapsed && (
                          <motion.div
                            key="conversation-agent-controls"
                            className="yachiyo-mobile-header-collapsible"
                            data-state="expanded"
                            initial={reduceMotion ? { height: 0, opacity: 0 } : { height: 0, opacity: 0, y: -8 }}
                            animate={reduceMotion ? { height: 'auto', opacity: 1 } : { height: 'auto', opacity: 1, y: 0 }}
                            exit={reduceMotion ? { height: 0, opacity: 0 } : { height: 0, opacity: 0, y: -8 }}
                            transition={
                              reduceMotion
                                ? { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }
                                : { type: 'spring', mass: 1, stiffness: 420, damping: 40 }
                            }
                          >
                            <motion.div
                              className="yachiyo-mobile-header-collapsible-inner"
                              initial={reduceMotion ? false : { scale: 0.99, filter: 'blur(3px)' }}
                              animate={{ scale: 1, filter: 'blur(0px)' }}
                              exit={reduceMotion ? { opacity: 0 } : { scale: 0.99, filter: 'blur(3px)' }}
                              transition={
                                reduceMotion
                                  ? { duration: 0.18, ease: 'easeOut' }
                                  : { type: 'spring', mass: 1, stiffness: 420, damping: 40 }
                              }
                            >
                              <AgentSessionControls
                                sessionId={conversationConfigId}
                                enabled={isAgentTaskPath}
                                onToggle={handleAgentToggle}
                                showStatus={false}
                              />
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </header>
              </div>
            </div>

            <AndroidMainTabPager
              activeTab={activeTab}
              items={shellTabs}
              renderPreview={renderTabPreview}
              renderSource={renderSourceContent}
              onChange={handleTabChange}
              onTransitionChange={setPagerTransition}
              interactionState={interactionState}
            >
              {content}
            </AndroidMainTabPager>
          </div>
        </AndroidSharedChromeHostProvider>
      </AndroidPagerGestureLockProvider>
    </AndroidAppShellContext.Provider>
  )
}
