import { Alert, Button, Loader, Stack, Text, Title } from '@mantine/core'
import { IconPuzzle } from '@tabler/icons-react'
import { Component, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Translation, useTranslation } from 'react-i18next'
import { parsePluginView, type PluginView, type ViewAction } from '@shared/plugins/view-schema'
import { isTrustedUbuntuPlugin } from '@shared/plugins/device-policy'
import { statusView as ubuntuStatusView } from '../../../examples/plugins/ubuntu-runtime/status-view.mjs'
import { isPluginUserDenial } from './plugin-consent-errors'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  disposePluginRuntime,
  invokeLoadedPluginTool,
  type LoadedPlugin,
  loadPluginForPage,
  recordPluginUiFailure,
} from './plugin-manager'
import { ViewRenderer } from './ViewRenderer'
import type { AndroidTabPageActivity } from '@/components/yachiyo/android-tab-page-activity'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'

type PluginPageState =
  | { phase: 'loading' }
  | ({ phase: 'cached' } & CachedPluginPage)
  | { phase: 'missing' }
  | { phase: 'denied'; capability: 'ui' | 'linux-runtime' }
  | { phase: 'feature-disabled' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; plugin: LoadedPlugin; view: PluginView | null }

type CachedPluginPage = {
  displayName: string
  entrySha256: string
  view: PluginView | null
}

const pluginPageCache = new Map<string, CachedPluginPage>()
const pluginUiInvocationQueues = new Map<string, Promise<void>>()

function enqueuePluginUiInvocation<T>(pluginId: string, invocation: () => Promise<T>): Promise<T> {
  const previous = pluginUiInvocationQueues.get(pluginId) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(invocation)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  pluginUiInvocationQueues.set(pluginId, tail)
  void tail.finally(() => {
    if (pluginUiInvocationQueues.get(pluginId) === tail) pluginUiInvocationQueues.delete(pluginId)
  })
  return result
}

async function invokePluginUiTool(
  pluginId: string,
  loaded: LoadedPlugin,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ plugin: LoadedPlugin; result: unknown }> {
  return enqueuePluginUiInvocation(pluginId, async () => {
    if (signal.aborted) throw new Error('cancelled')
    let plugin = loaded
    if (
      !plugin.runtime ||
      (typeof plugin.runtime.isDisposed === 'function' && plugin.runtime.isDisposed())
    ) {
      const reloaded = await loadPluginForPage(pluginId, { startRuntime: true })
      if (!reloaded?.uiGranted || !reloaded.runtime) throw new Error('plugin_runtime_unavailable')
      plugin = reloaded
    }
    const runtime = plugin.runtime
    if (!runtime) throw new Error('plugin_runtime_unavailable')
    const entrySha256 = plugin.record.manifest.entrySha256 ?? plugin.record.packageSha256
    const timeoutMs = name === 'verify_environment' && isTrustedUbuntuPlugin(plugin.record) ? 60_000 : undefined
    const context = {
      principal: { kind: 'plugin' as const, pluginId, entrySha256 },
      abortSignal: signal,
    }
    // The already-installed 1.0.0 worker renders a retained transfer as 100%, even after a failed
    // install. Read its granted status tool and share the signed successor's presentation logic.
    if (isTrustedUbuntuPlugin(plugin.record) && plugin.record.manifest.version === '1.0.0' &&
      (name === 'render' || name === 'install' || name === 'remove')) {
      if (name !== 'render') await invokeLoadedPluginTool(pluginId, runtime, name, args as never, timeoutMs, context)
      const status = await invokeLoadedPluginTool(pluginId, runtime, 'ubuntu-runtime_status', {}, undefined, context)
      if (!status || typeof status !== 'object' || Array.isArray(status) || typeof status.state !== 'string') {
        throw new Error('ubuntu_status_unavailable')
      }
      const accepted = name === 'install' ? { accepted: true, state: 'queued' } : undefined
      const view = parsePluginView(ubuntuStatusView({ ...status, state: status.state }, undefined, accepted))
      return { plugin, result: { ...view, children: view.children.filter((node) => node.key !== 'verify') } }
    }
    const result = await invokeLoadedPluginTool(pluginId, runtime, name, args as never, timeoutMs, context)
    return { plugin, result }
  })
}

export class PluginViewErrorBoundary extends Component<
  { pluginId: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    recordPluginUiFailure(this.props.pluginId, error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Translation>
        {(t) => (
          <Alert color="red" title={t('插件页面渲染失败')}>
            <Stack gap="xs">
              <Text size="sm">{this.state.error?.message || 'plugin_view_render_failed'}</Text>
              <Button size="compact-sm" variant="default" onClick={() => this.setState({ error: null })}>
                {t('重试')}
              </Button>
            </Stack>
          </Alert>
        )}
      </Translation>
    )
  }
}

/** Host-rendered plugin page shared by the exact route and its namespaced child routes. */
export function PluginPageHost({
  pluginId,
  activity = 'active',
}: {
  pluginId: string
  activity?: AndroidTabPageActivity
}) {
  const { t } = useTranslation()
  const translationRef = useRef(t)
  translationRef.current = t
  const inAndroidAppShell = useInAndroidAppShell()
  const pluginsEnabled = useSettingsStore((settings) => settings.featureOverrides?.plugins !== false)
  const [state, setState] = useState<PluginPageState>(() => {
    const cached = pluginPageCache.get(pluginId)
    return cached ? { phase: 'cached', ...cached } : { phase: 'loading' }
  })
  const stateRef = useRef<PluginPageState>(state)
  const actionQueue = useRef<Promise<void>>(Promise.resolve())
  const generation = useRef(0)
  const activityRef = useRef(activity)
  const lifecycleControllerRef = useRef<AbortController>()
  const [notice, setNotice] = useState<'cancelled' | 'expired' | null>(null)
  const [reload, setReload] = useState(0)
  const ubuntuMutation = useRef<string | null>(null)
  const ubuntuAcceptedUntil = useRef(0)

  activityRef.current = activity

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    lifecycleControllerRef.current?.abort()
    const controller = new AbortController()
    lifecycleControllerRef.current = controller
    const currentGeneration = ++generation.current
    const cached = pluginPageCache.get(pluginId)
    setNotice(null)
    ubuntuMutation.current = null
    ubuntuAcceptedUntil.current = 0

    if (!pluginsEnabled) {
      disposePluginRuntime(pluginId)
      setState({ phase: 'feature-disabled' })
      return () => {
        controller.abort()
        if (generation.current === currentGeneration) generation.current += 1
      }
    }

    setState(cached ? { phase: 'cached', ...cached } : { phase: 'loading' })
    void (async () => {
      try {
        let plugin = await loadPluginForPage(pluginId, { startRuntime: activity === 'active' })
        if (controller.signal.aborted || generation.current !== currentGeneration) return
        if (!plugin) {
          pluginPageCache.delete(pluginId)
          setState({ phase: 'missing' })
          return
        }
        if (!plugin.uiGranted || plugin.missingUiCapability) {
          pluginPageCache.delete(pluginId)
          setState({ phase: 'denied', capability: plugin.missingUiCapability || 'ui' })
          return
        }

        const entrySha256 = plugin.record.manifest.entrySha256 ?? plugin.record.packageSha256
        if (activity !== 'active') {
          const matchingCached = pluginPageCache.get(pluginId)
          const cachedPage: CachedPluginPage = {
            displayName: plugin.record.manifest.displayName,
            entrySha256,
            view: matchingCached?.entrySha256 === entrySha256 ? matchingCached.view : plugin.view,
          }
          pluginPageCache.set(pluginId, cachedPage)
          setState({ phase: 'cached', ...cachedPage })
          return
        }

        let view: PluginView | null = plugin.view
        if (plugin.runtime && plugin.tools.some((tool) => tool.name === 'render')) {
          const rendered = await invokePluginUiTool(pluginId, plugin, 'render', {}, controller.signal)
          plugin = rendered.plugin
          view = parsePluginView(rendered.result)
        }
        if (!controller.signal.aborted && generation.current === currentGeneration) {
          const readyState = { phase: 'ready' as const, plugin, view }
          pluginPageCache.set(pluginId, {
            displayName: plugin.record.manifest.displayName,
            entrySha256,
            view,
          })
          setState(readyState)
        }
      } catch (error) {
        if (!controller.signal.aborted && generation.current === currentGeneration) {
          setState({ phase: 'error', message: error instanceof Error ? error.message : String(translationRef.current('插件加载失败')) })
        }
      }
    })()
    return () => {
      controller.abort()
      if (lifecycleControllerRef.current === controller) lifecycleControllerRef.current = undefined
      if (generation.current === currentGeneration) generation.current += 1
    }
    // Translation initialization/language changes must not abort live plugin actions.
  }, [activity, pluginId, pluginsEnabled, reload])

  const onAction = useCallback(
    (action: ViewAction, extra?: Record<string, unknown>) => {
      const controller = lifecycleControllerRef.current
      if (activityRef.current !== 'active' || !controller || controller.signal.aborted) return
      const actionGeneration = generation.current
      const isUbuntuMutation = pluginId === 'ubuntu-runtime' && (action.handler === 'install' || action.handler === 'remove')
      if (isUbuntuMutation && ubuntuMutation.current) return
      if (isUbuntuMutation) ubuntuMutation.current = action.handler
      setNotice(null)
      const payload = {
        ...(typeof action.payload === 'object' && action.payload !== null ? action.payload : {}),
        ...extra,
      }
      // React state updaters must stay pure. Serialize user actions outside setState so StrictMode
      // cannot replay a plugin side effect and rapid actions are queued instead of silently dropped.
      actionQueue.current = actionQueue.current
        .catch(() => undefined)
        .then(async () => {
          const current = stateRef.current
          if (
            activityRef.current !== 'active' ||
            controller.signal.aborted ||
            generation.current !== actionGeneration ||
            current.phase !== 'ready' ||
            !current.plugin.runtime
          ) {
            return
          }
          try {
            const invocation = await invokePluginUiTool(
              pluginId,
              current.plugin,
              action.handler,
              payload as never,
              controller.signal,
            )
            if (
              activityRef.current !== 'active' ||
              controller.signal.aborted ||
              generation.current !== actionGeneration
            ) {
              return
            }
            try {
              const view = parsePluginView(invocation.result)
              if (isTrustedUbuntuPlugin(invocation.plugin.record)) {
                if (action.handler === 'install') ubuntuAcceptedUntil.current = Date.now() + 15_000
                if (action.handler === 'remove' || view.children.some((child) => child.type === 'badge' &&
                  child.key === 'state' && (child.tone === 'success' || child.tone === 'error'))) {
                  ubuntuAcceptedUntil.current = 0
                }
              }
              pluginPageCache.set(pluginId, {
                displayName: invocation.plugin.record.manifest.displayName,
                entrySha256:
                  invocation.plugin.record.manifest.entrySha256 ?? invocation.plugin.record.packageSha256,
                view,
              })
              setState((previous) =>
                previous.phase === 'ready' ? { ...previous, plugin: invocation.plugin, view } : previous,
              )
            } catch {
              // Action handlers may intentionally return data without replacing the view.
            }
          } catch (error) {
            if (
              activityRef.current === 'active' &&
              !controller.signal.aborted &&
              generation.current === actionGeneration
            ) {
              const message = error instanceof Error ? error.message : String(translationRef.current('插件执行失败'))
              if (isPluginUserDenial(message) || message === 'plugin_approval_expired') {
                setNotice(message === 'plugin_approval_expired' ? 'expired' : 'cancelled')
              } else {
                setState({ phase: 'error', message })
              }
            }
          }
        })
        .finally(() => {
          if (isUbuntuMutation && generation.current === actionGeneration) ubuntuMutation.current = null
        })
    },
    [pluginId],
  )

  useEffect(() => {
    // The official plugin marks a changing install stage with this view key. One request is
    // scheduled per completed render, so slow native reads never build up a polling queue.
    if (activity !== 'active' || state.phase !== 'ready' || !isTrustedUbuntuPlugin(state.plugin.record)) return
    // WorkManager may briefly return the *previous* idle snapshot immediately after accepting work.
    if (Date.now() >= ubuntuAcceptedUntil.current &&
      !state.view?.children.some((child) => child.key === 'ubuntu-install-active')) return
    const timer = setTimeout(() => onAction({ type: 'invoke', handler: 'render' }), 2500)
    return () => clearTimeout(timer)
  }, [activity, onAction, state])

  const openPermissions = async () => {
    const { router } = await import('@/router')
    await router.navigate({ to: '/settings/plugins', search: { plugin: pluginId } })
  }

  return (
    <main className="local-model-center local-model-download-queue" data-activity={activity}>
      {!inAndroidAppShell && (
        <header className="local-model-queue-heading">
          <Title order={2}>
            <IconPuzzle size={22} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            {state.phase === 'ready'
              ? state.plugin.record.manifest.displayName
              : state.phase === 'cached'
                ? state.displayName
                : t('插件')}
          </Title>
        </header>
      )}
      <Stack gap="md">
        {state.phase === 'loading' && <Loader mx="auto" my="lg" />}
        {state.phase === 'missing' && (
          <Alert color="yellow" title={t('插件未安装')}>
            <Text size="sm">{t('未找到已安装的插件 “{{pluginId}}”。请先在 设置 → 插件 中安装。', { pluginId })}</Text>
          </Alert>
        )}
        {state.phase === 'feature-disabled' && (
          <Alert color="yellow" title={t('插件功能已关闭')}>
            <Text size="sm">{t('请先在“设置 → 功能模块”中启用第三方插件，再打开此页面。')}</Text>
          </Alert>
        )}
        {state.phase === 'denied' && (
          <Alert color="yellow" title={t(state.capability === 'ui' ? '未授权界面能力' : 'Ubuntu 运行环境未授权')}>
            <Text size="sm">{t(state.capability === 'ui' ? '此插件的 UI 能力未授权。请在 设置 → 插件 中重新授权后再打开。' : '请在“设置 → 插件 → 权限与活动”中授予 Ubuntu 发行版运行环境权限。')}</Text>
            <Button mt="xs" size="compact-sm" variant="default" onClick={openPermissions}>{t('权限与活动')}</Button>
          </Alert>
        )}
        {state.phase === 'error' && (
          <Alert color="red" title={t('插件出错')}>
            <Text size="sm">{state.message}</Text>
            <Button mt="xs" size="compact-sm" variant="default" onClick={() => setReload((value) => value + 1)}>{t('重试')}</Button>
            {(state.message.startsWith('plugin_disabled') || state.message.startsWith('capability_denied')) &&
              <Button mt="xs" ml="xs" size="compact-sm" variant="default" onClick={openPermissions}>{t('权限与活动')}</Button>}
          </Alert>
        )}
        {notice && <Alert color="yellow">{t(notice === 'expired' ? '审批已过期，可以重新发起操作。' : '已取消本次操作。')}</Alert>}
        {state.phase === 'cached' && !state.view && <Loader mx="auto" my="lg" />}
        {state.phase === 'cached' && state.view && (
          <PluginViewErrorBoundary key={pluginId} pluginId={pluginId}>
            <ViewRenderer view={state.view} onAction={onAction} />
          </PluginViewErrorBoundary>
        )}
        {state.phase === 'ready' &&
          (state.view ? (
            <PluginViewErrorBoundary key={pluginId} pluginId={pluginId}>
              <ViewRenderer view={state.view} onAction={onAction} />
            </PluginViewErrorBoundary>
          ) : (
            <Text c="dimmed" ta="center" py="md">
              {t('此插件没有提供页面内容。')}
            </Text>
          ))}
      </Stack>
    </main>
  )
}
