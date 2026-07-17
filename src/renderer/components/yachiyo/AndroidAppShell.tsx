import { App } from '@capacitor/app'
import { ActionIcon } from '@mantine/core'
import { IconChevronLeft, IconHistory } from '@tabler/icons-react'
import { useLocation } from '@tanstack/react-router'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { copyAgentSessionConfig, saveAgentSessionConfig } from '@/mobile/agent-session-config'
import {
  type AndroidShellTab,
  createYachiyoApiSettingsPatch,
  hasConfiguredModelProvider,
  hasYachiyoDefaultModel,
  isAllowedAndroidShellPath,
  resolveAndroidShellBackAction,
  resolveAndroidShellTab,
  resolveAndroidShellWorkspaceView,
} from '@/mobile/android-app-shell'
import { ensureAgentTaskForChat, ensureChatSessionForTask, openTaskSessionAsChat } from '@/mobile/conversation-bridge'
import { removeBuiltInDemoSessions } from '@/mobile/demo-session-cleanup'
import { fetchYachiyoModels } from '@/mobile/yachiyo-api'
import { router } from '@/router'
import { useSession } from '@/stores/chatStore'
import { createEmpty, switchCurrentSession } from '@/stores/sessionActions'
import { persistSettingsPatch, useSettingsStore } from '@/stores/settingsStore'
import { getTaskSession, taskSessionStore, useTaskSessionRecord } from '@/stores/taskSessionStore'
import { AgentApprovalDialog } from './AgentApprovalDialog'
import { AgentSessionControls } from './AgentSessionControls'
import { AndroidAppShellContext } from './AndroidAppShellContext'
import { AndroidBottomNavigation } from './AndroidBottomNavigation'
import { AndroidConversationHistory } from './AndroidConversationHistory'
import { AndroidPermissionWizard } from './AndroidPermissionWizard'
import { AndroidScheduledTaskRunner } from './AndroidScheduledTasks'
import { AndroidSettingsHome } from './AndroidSettingsHome'
import { AndroidAboutWorkspace, AndroidTasksWorkspace } from './AndroidWorkspaceHome'
import { YachiyoApiOnboarding } from './YachiyoApiOnboarding'
import { YachiyoChatLanding } from './YachiyoChatLanding'
import { YachiyoMark } from './YachiyoMark'
import './android-app-shell.css'

const TAB_TITLES: Record<AndroidShellTab, string> = {
  chat: '聊天',
  interactive: '交互式',
  tasks: '任务',
  settings: '设置',
}

export function AndroidAppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const lastConversationPathname = useRef(
    location.pathname === '/' || location.pathname.startsWith('/session/') || location.pathname.startsWith('/task/')
      ? location.pathname
      : '/'
  )
  const [historyOpened, setHistoryOpened] = useState(false)
  const customProviders = useSettingsStore((state) => state.customProviders)
  const defaultChatModel = useSettingsStore((state) => state.defaultChatModel)
  const licenseKey = useSettingsStore((state) => state.licenseKey)
  const providers = useSettingsStore((state) => state.providers)
  const settings = useMemo(
    () => ({ customProviders, defaultChatModel, licenseKey, providers }),
    [customProviders, defaultChatModel, licenseKey, providers]
  )
  const hasProvider = useMemo(() => hasConfiguredModelProvider(settings), [settings])
  const activeTab = resolveAndroidShellTab(location.pathname)
  const workspaceView = resolveAndroidShellWorkspaceView(location.pathname)
  const isAllowedPath = isAllowedAndroidShellPath(location.pathname)
  const isAgentTaskPath = location.pathname === '/task' || location.pathname.startsWith('/task/')
  const isSettingsDetail = activeTab === 'settings' && location.pathname !== '/settings'
  const isInteractive = activeTab === 'interactive'

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

    if (tab === 'tasks') {
      await router.navigate({ to: '/tasks', replace: true })
      return
    }

    if (tab === 'settings') {
      await router.navigate({ to: '/settings', replace: true })
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
        <AndroidScheduledTaskRunner />
        <AndroidPermissionWizard />
        <AgentApprovalDialog />
        <AndroidConversationHistory
          opened={historyOpened}
          mode={isAgentTaskPath ? 'agent' : 'chat'}
          currentId={location.pathname.split('/').at(-1)}
          onClose={() => setHistoryOpened(false)}
        />
        {!isInteractive && <header className="yachiyo-mobile-header">
          {isSettingsDetail ? (
            <ActionIcon
              variant="subtle"
              color="gray"
              size={36}
              aria-label="返回设置"
              onClick={() => router.navigate({ to: '/settings' })}
            >
              <IconChevronLeft size={22} />
            </ActionIcon>
          ) : (
            <YachiyoMark size={36} />
          )}
          <div className="yachiyo-mobile-title">
            <strong>{conversationTitle || 'Yachiyo Claw'}</strong>
            <span>{isAgentTaskPath ? 'Agent 对话' : TAB_TITLES[activeTab]}</span>
          </div>
          {activeTab === 'chat' && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size={36}
              aria-label="会话记录"
              onClick={() => setHistoryOpened(true)}
            >
              <IconHistory size={21} />
            </ActionIcon>
          )}
          <div className="yachiyo-connection-status" data-connected={hasProvider ? 'true' : 'false'}>
            <span aria-hidden="true" />
            {hasProvider ? '已连接' : '未连接'}
          </div>
          {activeTab === 'chat' && (
            <AgentSessionControls
              sessionId={conversationConfigId}
              enabled={isAgentTaskPath}
              onToggle={handleAgentToggle}
            />
          )}
        </header>}

        <div className="yachiyo-mobile-content">{content}</div>

        <AndroidBottomNavigation activeTab={activeTab} onChange={(tab) => void handleTabChange(tab)} />
      </div>
    </AndroidAppShellContext.Provider>
  )
}
