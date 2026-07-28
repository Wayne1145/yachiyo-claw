import { App } from '@capacitor/app'
import { ActionIcon } from '@mantine/core'
import { IconChevronDown, IconChevronLeft, IconChevronUp, IconHistory, IconPuzzle } from '@tabler/icons-react'
import { useLocation } from '@tanstack/react-router'
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
  resolveAndroidShellTab,
  resolveAndroidShellWorkspaceView,
} from '@/mobile/android-app-shell'
import { getOverlays } from '@/features/ui-registry'
import { registerBuiltinFeatureOverlays } from '@/features/builtin-overlays'
import { getEnabledFeatureIds } from '@/features/feature-runtime'
import { ensureAgentTaskForChat, ensureChatSessionForTask, openTaskSessionAsChat } from '@/mobile/conversation-bridge'
import { removeBuiltInDemoSessions } from '@/mobile/demo-session-cleanup'
import { syncInstalledLocalModelsIntoSettings } from '@/mobile/local-model-provider-sync'
import { fetchYachiyoModels } from '@/mobile/yachiyo-api'
import { yachiyoDownloadsNative } from '@/platform/native/yachiyo_downloads'
import { router } from '@/router'
import { initThemeApplication } from '@/stores/themeStore'
import { initPluginTools, usePluginStore } from '@/plugins/plugin-manager'
import { startPendingPluginInstallRecovery } from '@/plugins/install-recovery'
import { startPendingThemeImportRecovery } from '@/themes/remote-theme'
import { pruneAbandonedEmptySessions, useSession } from '@/stores/chatStore'
import { createEmpty, switchCurrentSession } from '@/stores/sessionActions'
import { persistSettingsPatch, useSettingsStore } from '@/stores/settingsStore'
import { getTaskSession, listAllTaskSessions, taskSessionStore, useTaskSessionRecord } from '@/stores/taskSessionStore'
import { AgentSessionControls } from './AgentSessionControls'
import Toolbar from '@/components/layout/Toolbar'
import { AndroidAppShellContext } from './AndroidAppShellContext'
import { AndroidBottomNavigation } from './AndroidBottomNavigation'
import { AndroidConversationHistory } from './AndroidConversationHistory'
import { AndroidSettingsHome } from './AndroidSettingsHome'
import { AndroidAboutWorkspace, AndroidTasksWorkspace } from './AndroidWorkspaceHome'
import { YachiyoApiOnboarding } from './YachiyoApiOnboarding'
import { YachiyoChatLanding } from './YachiyoChatLanding'
import { YachiyoMark } from './YachiyoMark'
import './android-app-shell.css'
import './local-model-center.css'

export function AndroidAppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const location = useLocation()
  const lastConversationPathname = useRef(
    location.pathname === '/' || location.pathname.startsWith('/session/') || location.pathname.startsWith('/task/')
      ? location.pathname
      : '/'
  )
  const [historyOpened, setHistoryOpened] = useState(false)
  const [conversationHeaderCollapsed, setConversationHeaderCollapsed] = useState(false)
  const customProviders = useSettingsStore((state) => state.customProviders)
  const defaultChatModel = useSettingsStore((state) => state.defaultChatModel)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const providers = useSettingsStore((state) => state.providers)
  const featureOverrides = useSettingsStore((state) => state.featureOverrides)
  const installedPlugins = usePluginStore((state) => state.installed)
  const contributionPluginIds = usePluginStore((state) => state.contributionPluginIds)
  const settings = useMemo(
    () => ({ customProviders, defaultChatModel, licenseKey, providers }),
    [customProviders, defaultChatModel, licenseKey, providers]
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
      location.pathname.startsWith(`/plugin/${record.manifest.id}/`)
  )
  const activeTab = activePlugin ? `plugin-${activePlugin.manifest.id}` : resolveAndroidShellTab(location.pathname)
  const activeTabLabel = t(
    shellTabs.find((tab) => tab.id === activeTab)?.label ?? activePlugin?.manifest.displayName ?? '聊天'
  )
  const workspaceView = resolveAndroidShellWorkspaceView(location.pathname)
  const isAllowedPath = isAllowedAndroidShellPath(location.pathname)
  const isAgentTaskPath = location.pathname === '/task' || location.pathname.startsWith('/task/')
  const isSettingsDetail = activeTab === 'settings' && location.pathname !== '/settings'
  const isInteractive = activeTab === 'interactive'

  useLayoutEffect(() => {
    // Apply persisted theme tokens before the shell is painted to avoid a default-color flash.
    initThemeApplication()
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
    []
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
          tasks.map((task) => task.linkedSessionId).filter((id): id is string => Boolean(id))
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
    let disposed = false
    let removeListener: (() => Promise<void>) | undefined

    void App.addListener('backButton', async () => {
      if (historyOpened) {
        setHistoryOpened(false)
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
    const taskMatch = location.pathname.match(/^\/task\/([^/]+)$/)

    if (tab === 'interactive') {
      let sessionId = location.pathname.match(/^\/session\/([^/]+)$/)?.[1]
      if (!sessionId && taskMatch?.[1]) sessionId = await ensureChatSessionForTask(taskMatch[1])
      if (!sessionId) {
        const savedChatMatch = lastConversationPathname.current.match(/^\/session\/([^/]+)$/)
        const savedTaskMatch = lastConversationPathname.current.match(/^\/task\/([^/]+)$/)
        sessionId = savedChatMatch?.[1]
        if (!sessionId && savedTaskMatch?.[1]) sessionId = await ensureChatSessionForTask(savedTaskMatch[1])
      }
      if (!sessionId) sessionId = (await createEmpty('chat')).id
      await router.navigate({ to: '/interactive', search: { sessionId }, replace: true })
      return
    }

    if (tab !== 'chat') {
      const destination = shellTabs.find((candidate) => candidate.id === tab)
      if (destination) await router.navigate({ to: destination.route as '/', replace: true })
      return
    }
    if (taskMatch?.[1]) {
      await openTaskSessionAsChat(taskMatch[1])
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

  const content = (() => {
    if (workspaceView === 'tasks') return <AndroidTasksWorkspace />
    if (workspaceView === 'about') return <AndroidAboutWorkspace />
    if (workspaceView === 'settings') return <AndroidSettingsHome />
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
    return activeTab === 'settings' ? <div className="yachiyo-settings-detail">{children}</div> : children
  })()

  return (
    <AndroidAppShellContext.Provider value={true}>
      <div className="yachiyo-mobile-shell">
        {shellOverlays.map((Overlay, index) => (
          <Overlay key={`${Overlay.displayName || Overlay.name || 'feature-overlay'}-${index}`} />
        ))}
        <AndroidConversationHistory
          opened={historyOpened}
          mode={isAgentTaskPath ? 'agent' : 'chat'}
          currentId={location.pathname.split('/').at(-1)}
          onClose={() => setHistoryOpened(false)}
        />
        {!isInteractive && (
          <div className="yachiyo-mobile-header-drawer">
            <div className="yachiyo-mobile-header-drawer-inner">
              <header className="yachiyo-mobile-header">
                <div className="yachiyo-mobile-header-primary">
                  {isSettingsDetail ? (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size={36}
                      aria-label={String(t('返回设置'))}
                      onClick={() => router.navigate({ to: '/settings' })}
                    >
                      <IconChevronLeft size={22} />
                    </ActionIcon>
                  ) : (
                    <YachiyoMark size={36} />
                  )}
                  <div className="yachiyo-mobile-title">
                    <strong>{conversationTitle || 'Yachiyo Claw'}</strong>
                    <span>{isAgentTaskPath ? t('Agent 对话') : activeTabLabel}</span>
                  </div>
                  {showConversationTools && (
                    <div className="yachiyo-mobile-conversation-tools">
                      <Toolbar sessionId={toolbarSessionId} androidShell />
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size={36}
                        aria-label={String(t('会话记录'))}
                        onClick={() => setHistoryOpened(true)}
                      >
                        <IconHistory size={21} />
                      </ActionIcon>
                    </div>
                  )}
                  <div className="yachiyo-connection-status" data-connected={hasProvider ? 'true' : 'false'}>
                    <span aria-hidden="true" />
                    {hasProvider ? t('已连接') : t('未连接')}
                  </div>
                  {activeTab === 'chat' && (
                    <ActionIcon
                      className="yachiyo-mobile-header-collapse"
                      variant="subtle"
                      color="gray"
                      size={30}
                      aria-label={String(conversationHeaderCollapsed ? t('展开顶部') : t('收起顶部'))}
                      aria-expanded={!conversationHeaderCollapsed}
                      onClick={() => setConversationHeaderCollapsed((value) => !value)}
                    >
                      {conversationHeaderCollapsed ? <IconChevronDown size={18} /> : <IconChevronUp size={18} />}
                    </ActionIcon>
                  )}
                </div>
                {activeTab === 'chat' && (
                  <div
                    className="yachiyo-mobile-header-collapsible"
                    data-collapsed={conversationHeaderCollapsed ? 'true' : 'false'}
                  >
                    <div className="yachiyo-mobile-header-collapsible-inner">
                      <AgentSessionControls
                        sessionId={conversationConfigId}
                        enabled={isAgentTaskPath}
                        onToggle={handleAgentToggle}
                      />
                    </div>
                  </div>
                )}
              </header>
            </div>
          </div>
        )}

        <div key={location.pathname} className="yachiyo-mobile-content">
          {content}
        </div>

        <AndroidBottomNavigation
          activeTab={activeTab}
          items={shellTabs}
          onChange={(tab) => void handleTabChange(tab)}
        />
      </div>
    </AndroidAppShellContext.Provider>
  )
}
