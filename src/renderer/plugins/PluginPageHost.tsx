import { Alert, Button, Loader, Stack, Text, Title } from '@mantine/core'
import { IconPuzzle } from '@tabler/icons-react'
import { Component, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { parsePluginView, type PluginView, type ViewAction } from '@shared/plugins/view-schema'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  disposePluginRuntime,
  invokeLoadedPluginTool,
  type LoadedPlugin,
  loadPluginForPage,
  recordPluginUiFailure,
} from './plugin-manager'
import { ViewRenderer } from './ViewRenderer'

type PluginPageState =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'denied' }
  | { phase: 'feature-disabled' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; plugin: LoadedPlugin; view: PluginView | null }

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
      <Alert color="red" title="插件页面渲染失败">
        <Stack gap="xs">
          <Text size="sm">{this.state.error.message || 'plugin_view_render_failed'}</Text>
          <Button size="compact-sm" variant="default" onClick={() => this.setState({ error: null })}>
            重试
          </Button>
        </Stack>
      </Alert>
    )
  }
}

/** Host-rendered plugin page shared by the exact route and its namespaced child routes. */
export function PluginPageHost({ pluginId }: { pluginId: string }) {
  const pluginsEnabled = useSettingsStore((settings) => settings.featureOverrides?.plugins !== false)
  const [state, setState] = useState<PluginPageState>({ phase: 'loading' })
  const stateRef = useRef<PluginPageState>(state)
  const actionQueue = useRef<Promise<void>>(Promise.resolve())
  const generation = useRef(0)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    let cancelled = false
    const currentGeneration = ++generation.current
    if (!pluginsEnabled) {
      disposePluginRuntime(pluginId)
      setState({ phase: 'feature-disabled' })
      return () => {
        cancelled = true
      }
    }
    setState({ phase: 'loading' })
    void (async () => {
      try {
        const plugin = await loadPluginForPage(pluginId)
        if (cancelled || generation.current !== currentGeneration) return
        if (!plugin) {
          setState({ phase: 'missing' })
          return
        }
        if (!plugin.uiGranted) {
          setState({ phase: 'denied' })
          return
        }
        let view: PluginView | null = plugin.view
        if (plugin.runtime && plugin.tools.some((tool) => tool.name === 'render')) {
          view = parsePluginView(
            await invokeLoadedPluginTool(pluginId, plugin.runtime, 'render', {}, undefined, {
              principal: {
                kind: 'plugin',
                pluginId,
                entrySha256: plugin.record.manifest.entrySha256 ?? plugin.record.packageSha256,
              },
            })
          )
        }
        if (!cancelled && generation.current === currentGeneration) {
          setState({ phase: 'ready', plugin, view })
        }
      } catch (error) {
        if (!cancelled && generation.current === currentGeneration) {
          setState({ phase: 'error', message: error instanceof Error ? error.message : '插件加载失败' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pluginId, pluginsEnabled])

  const onAction = useCallback(
    (action: ViewAction, extra?: Record<string, unknown>) => {
      const actionGeneration = generation.current
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
          if (generation.current !== actionGeneration || current.phase !== 'ready' || !current.plugin.runtime) {
            return
          }
          try {
            const result = await invokeLoadedPluginTool(
              pluginId,
              current.plugin.runtime,
              action.handler,
              payload as never,
              undefined,
              {
                principal: {
                  kind: 'plugin',
                  pluginId,
                  entrySha256: current.plugin.record.manifest.entrySha256 ?? current.plugin.record.packageSha256,
                },
              }
            )
            if (generation.current !== actionGeneration) return
            try {
              const view = parsePluginView(result)
              setState((previous) => (previous.phase === 'ready' ? { ...previous, view } : previous))
            } catch {
              // Action handlers may intentionally return data without replacing the view.
            }
          } catch (error) {
            if (generation.current === actionGeneration) {
              setState({ phase: 'error', message: error instanceof Error ? error.message : '插件执行失败' })
            }
          }
        })
    },
    [pluginId]
  )

  return (
    <main className="local-model-center local-model-download-queue">
      <header className="local-model-queue-heading">
        <Title order={2}>
          <IconPuzzle size={22} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
          {state.phase === 'ready' ? state.plugin.record.manifest.displayName : '插件'}
        </Title>
      </header>
      <Stack gap="md">
        {state.phase === 'loading' && <Loader mx="auto" my="lg" />}
        {state.phase === 'missing' && (
          <Alert color="yellow" title="插件未安装">
            <Text size="sm">未找到已安装的插件 “{pluginId}”。请先在 设置 → 插件 中安装。</Text>
          </Alert>
        )}
        {state.phase === 'feature-disabled' && (
          <Alert color="yellow" title="插件功能已关闭">
            <Text size="sm">请先在“设置 → 功能模块”中启用第三方插件，再打开此页面。</Text>
          </Alert>
        )}
        {state.phase === 'denied' && (
          <Alert color="yellow" title="未授权界面能力">
            <Text size="sm">此插件的 UI 能力未授权。请在 设置 → 插件 中重新授权后再打开。</Text>
          </Alert>
        )}
        {state.phase === 'error' && (
          <Alert color="red" title="插件出错">
            <Text size="sm">{state.message}</Text>
          </Alert>
        )}
        {state.phase === 'ready' &&
          (state.view ? (
            <PluginViewErrorBoundary key={pluginId} pluginId={pluginId}>
              <ViewRenderer view={state.view} onAction={onAction} />
            </PluginViewErrorBoundary>
          ) : (
            <Text c="dimmed" ta="center" py="md">
              此插件没有提供页面内容。
            </Text>
          ))}
      </Stack>
    </main>
  )
}
