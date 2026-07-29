import { Loader, Text, Title } from '@mantine/core'
import { getMessageText } from '@shared/utils/message'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AndroidShellTab } from '@/mobile/android-app-shell'
import { PluginPageHost } from '@/plugins/PluginPageHost'
import { useSession } from '@/stores/chatStore'
import { useTaskSessionRecord } from '@/stores/taskSessionStore'
import { DownloadsCenter } from './DownloadsCenter'
import { FeatureManager } from './FeatureManager'
import { LocalModelCenter } from './LocalModelCenter'
import { AndroidInteractive } from './AndroidInteractive'
import { PluginCenter } from './PluginCenter'
import { PluginRuntimeTest } from './PluginRuntimeTest'
import { AndroidSettingsHome } from './AndroidSettingsHome'
import { AndroidSettingsStackSurface } from './AndroidSettingsStackSurface'
import { ThemeCenter } from './ThemeCenter'
import { AndroidAboutWorkspace, AndroidTasksWorkspace } from './AndroidWorkspaceHome'
import { YachiyoChatLanding } from './YachiyoChatLanding'

export interface AndroidSavedTabLocation {
  pathname: string
  search: Readonly<Record<string, unknown>>
}

export type AndroidTabPreviewKind =
  | 'chat-landing'
  | 'chat-session'
  | 'task-new'
  | 'task-session'
  | 'tasks'
  | 'develop'
  | 'interactive'
  | 'settings-home'
  | 'settings-themes'
  | 'settings-plugins'
  | 'settings-local-models'
  | 'settings-downloads'
  | 'settings-features'
  | 'settings-plugin-runtime'
  | 'settings-about'
  | 'settings-detail'
  | 'plugin-page'
  | 'saved-destination'

export interface AndroidTabPreviewResolution extends AndroidSavedTabLocation {
  kind: AndroidTabPreviewKind
  resourceId?: string
}

function pathResourceId(pathname: string, prefix: string): string | undefined {
  const match = pathname.match(new RegExp(`^/${prefix}/([^/]+)/?$`))
  return match?.[1]
}

export function resolveAndroidTabPagePreview({
  tab,
  savedLocation,
  fallbackRoute,
}: {
  tab: AndroidShellTab
  savedLocation?: AndroidSavedTabLocation
  fallbackRoute: string
}): AndroidTabPreviewResolution {
  const pathname = savedLocation?.pathname || fallbackRoute
  const search = savedLocation?.search || {}

  if (tab.startsWith('plugin-') || pathname.startsWith('/plugin/')) {
    return {
      kind: 'plugin-page',
      pathname,
      search,
      resourceId: pathname.split('/').filter(Boolean)[1] || tab.slice('plugin-'.length),
    }
  }

  if (tab === 'interactive' || pathname === '/interactive') {
    return { kind: 'interactive', pathname, search }
  }

  if (tab === 'tasks') return { kind: 'tasks', pathname, search }

  if (tab === 'develop' || pathname === '/develop' || pathname.startsWith('/develop/')) {
    return { kind: 'develop', pathname, search }
  }

  if (tab === 'settings') {
    const settingsKind: Partial<Record<string, AndroidTabPreviewKind>> = {
      '/settings/themes': 'settings-themes',
      '/settings/plugins': 'settings-plugins',
      '/settings/local-models': 'settings-local-models',
      '/settings/downloads': 'settings-downloads',
      '/settings/features': 'settings-features',
      '/settings/plugin-runtime-test': 'settings-plugin-runtime',
      '/about': 'settings-about',
    }
    if (pathname === '/settings' || pathname === '/settings/') {
      return { kind: 'settings-home', pathname, search }
    }
    return { kind: settingsKind[pathname] || 'settings-detail', pathname, search }
  }

  const chatSessionId = pathResourceId(pathname, 'session')
  if (chatSessionId) return { kind: 'chat-session', pathname, search, resourceId: chatSessionId }
  const taskSessionId = pathResourceId(pathname, 'task')
  if (taskSessionId) return { kind: 'task-session', pathname, search, resourceId: taskSessionId }
  if (pathname === '/task' || pathname === '/task/') return { kind: 'task-new', pathname, search }
  if (tab === 'chat' || pathname === '/') return { kind: 'chat-landing', pathname, search }

  return { kind: 'saved-destination', pathname, search }
}

function AndroidConversationPreview({ id, kind }: { id: string; kind: 'chat' | 'task' }) {
  const { t } = useTranslation()
  const chatRecord = useSession(kind === 'chat' ? id : null)
  const taskRecord = useTaskSessionRecord(kind === 'task' ? id : null)
  const record = kind === 'chat' ? chatRecord.session : taskRecord.data
  const loading = kind === 'chat' ? chatRecord.isFetching : taskRecord.isFetching
  const messages = (record?.messages || []).filter((message) => message.role !== 'system').slice(-8)

  return (
    <main className="yachiyo-conversation-route-preview" data-conversation-preview={kind}>
      <div className="yachiyo-conversation-preview-list">
        {loading && !record ? <Loader size="sm" /> : null}
        {!loading && !record ? (
          <Text c="dimmed">{t(kind === 'chat' ? 'Conversation not found' : 'Task not found')}</Text>
        ) : null}
        {messages.map((message) => (
          <div key={message.id} className="yachiyo-conversation-preview-message" data-role={message.role}>
            <Text size="sm">{getMessageText(message, true, true) || (message.generating ? t('Loading...') : '')}</Text>
          </div>
        ))}
      </div>
      <div className="yachiyo-conversation-preview-composer" aria-hidden="true" />
    </main>
  )
}

function SavedDestinationPreview({ pathname, title }: { pathname: string; title: string }) {
  return (
    <main className="yachiyo-saved-destination-preview">
      <Title order={2}>{title}</Title>
      <Text c="dimmed" size="sm">
        {pathname}
      </Text>
      <div className="yachiyo-saved-destination-preview-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  )
}

function DevelopTabPreview() {
  return (
    <main className="coding-tab-preview">
      <div>
        <h2>手机开发</h2>
        <p>创建、审查并运行本机项目</p>
      </div>
      <div className="coding-tab-preview-actions" aria-hidden="true"><span /><span /></div>
      <div className="coding-tab-preview-status" aria-hidden="true"><span /><span /><span /></div>
    </main>
  )
}

function SettingsDetailPreview({ pathname, children }: { pathname: string; children: ReactNode }) {
  return (
    <AndroidSettingsStackSurface pathname={pathname}>
      <div className="yachiyo-settings-detail">{children}</div>
    </AndroidSettingsStackSurface>
  )
}

export function AndroidTabPagePreview({
  tab,
  savedLocation,
  fallbackRoute,
}: {
  tab: AndroidShellTab
  savedLocation?: AndroidSavedTabLocation
  fallbackRoute: string
}) {
  const { t } = useTranslation()
  const resolution = resolveAndroidTabPagePreview({ tab, savedLocation, fallbackRoute })
  let content: ReactNode

  switch (resolution.kind) {
    case 'chat-session':
      content = <AndroidConversationPreview id={resolution.resourceId || ''} kind="chat" />
      break
    case 'task-session':
      content = <AndroidConversationPreview id={resolution.resourceId || ''} kind="task" />
      break
    case 'task-new':
      content = <SavedDestinationPreview pathname={resolution.pathname} title={String(t('New Task'))} />
      break
    case 'tasks':
      content = <AndroidTasksWorkspace />
      break
    case 'develop':
      content = <DevelopTabPreview />
      break
    case 'interactive': {
      const sessionId = resolution.search.sessionId
      content = (
        <AndroidInteractive
          sessionId={typeof sessionId === 'string' ? sessionId : undefined}
          onSessionChange={() => undefined}
          activity="preview"
        />
      )
      break
    }
    case 'settings-home':
      content = <AndroidSettingsHome />
      break
    case 'settings-themes':
      content = (
        <SettingsDetailPreview pathname={resolution.pathname}>
          <ThemeCenter />
        </SettingsDetailPreview>
      )
      break
    case 'settings-plugins':
      content = (
        <SettingsDetailPreview pathname={resolution.pathname}>
          <PluginCenter />
        </SettingsDetailPreview>
      )
      break
    case 'settings-local-models':
      content = (
        <SettingsDetailPreview pathname={resolution.pathname}>
          <LocalModelCenter />
        </SettingsDetailPreview>
      )
      break
    case 'settings-downloads':
      content = (
        <SettingsDetailPreview pathname={resolution.pathname}>
          <DownloadsCenter />
        </SettingsDetailPreview>
      )
      break
    case 'settings-features':
      content = (
        <SettingsDetailPreview pathname={resolution.pathname}>
          <FeatureManager />
        </SettingsDetailPreview>
      )
      break
    case 'settings-plugin-runtime':
      content = (
        <SettingsDetailPreview pathname={resolution.pathname}>
          <PluginRuntimeTest />
        </SettingsDetailPreview>
      )
      break
    case 'settings-about':
      content = <AndroidAboutWorkspace />
      break
    case 'settings-detail':
      content = (
        <SettingsDetailPreview pathname={resolution.pathname}>
          <SavedDestinationPreview pathname={resolution.pathname} title={String(t('Settings'))} />
        </SettingsDetailPreview>
      )
      break
    case 'plugin-page':
      content = <PluginPageHost pluginId={resolution.resourceId || ''} activity="preview" />
      break
    case 'saved-destination':
      content = <SavedDestinationPreview pathname={resolution.pathname} title={String(t('Loading...'))} />
      break
    default:
      content = <YachiyoChatLanding />
  }

  return (
    <div
      className="yachiyo-tab-route-preview"
      data-preview-kind={resolution.kind}
      data-preview-path={resolution.pathname}
    >
      {content}
    </div>
  )
}
