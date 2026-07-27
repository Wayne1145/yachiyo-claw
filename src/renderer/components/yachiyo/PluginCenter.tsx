import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  FileButton,
  Group,
  List,
  Modal,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import {
  IconArrowBackUp,
  IconArrowLeft,
  IconBrandGithub,
  IconDownload,
  IconPuzzle,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { isPluginCompatible, type PluginHealth } from '@shared/plugins/lifecycle'
import type { PluginMarketplaceEntry } from '@shared/plugins/marketplace'
import { isPluginCapabilityImplemented } from '@shared/plugins/device-policy'
import { PLUGIN_PACKAGE_LIMITS } from '@shared/plugins/package'
import { readAgentAudit } from '@/mobile/agent-broker'
import platform from '@/platform'
import { router } from '@/router'
import { pluginDataStore } from '@/plugins/capacitor-stores'
import {
  getPluginGrants,
  pluginHealthStore,
  readPluginAudit,
  reenableDisabledPlugin,
  setPluginGrant,
  usePluginStore,
} from '@/plugins/plugin-manager'
import type { InstalledPluginRecord } from '@/plugins/installer'
import {
  DEFAULT_PLUGIN_MARKETPLACE_URL,
  downloadPluginPackage,
  loadPluginMarketplace,
  marketplacePackage,
  pluginPackageDownloadRequest,
  resolvePluginPackageSource,
} from '@/plugins/package-source'
import { clearPendingPluginInstall, savePendingPluginInstall } from '@/plugins/pending-install'
import { describePluginUpdate, findMarketplacePluginUpdates } from '@/plugins/plugin-updates'
import { useInAndroidAppShell } from './AndroidAppShellContext'

/**
 * Plugin management UI (platform-30 minimal + platform-23 consent).
 *
 * The consent sheet is host-rendered (plugins can never draw anything resembling it), lists each
 * requested capability with the manifest's reason. Device access is never granted during install;
 * a verified plugin must request it again from its detail page.
 */

const CAPABILITY_LABELS: Record<string, string> = {
  storage: '本地存储(仅本插件的独立空间)',
  ui: '插件页面(在 /plugin 内渲染界面)',
  tools: '向 Agent 提供工具',
  sandbox: 'Linux 开发环境脚本（高风险）',
  network: '访问声明的网络域名',
  device: '设备控制(高风险)',
}

const SOURCE_LABELS: Record<string, string> = {
  marketplace: '官方市场',
  https: 'HTTPS / GitHub',
  sideload: '本地侧载',
}

function pluginCenterErrorMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message.trim() : ''
  if (!message) return fallback

  const marketplaceHttp = /^plugin_marketplace_http_(\d{3})$/i.exec(message)
  if (marketplaceHttp) {
    return marketplaceHttp[1] === '404'
      ? '插件市场地址不存在或尚未发布，请稍后重试。'
      : `插件市场暂时无法访问（服务器返回 ${marketplaceHttp[1]}），请稍后重试。`
  }

  const downloadHttp = /^(?:(?:plugin_)?download_http|plugin_package_probe_http|github_release_http)_(\d{3})$/i.exec(
    message
  )
  if (downloadHttp) {
    return downloadHttp[1] === '404'
      ? '插件下载地址不存在或文件已被移除，请检查地址后重试。'
      : `插件下载失败（服务器返回 ${downloadHttp[1]}），请稍后重试。`
  }

  const knownMessages: Record<string, string> = {
    plugin_url_must_be_public_https: '仅支持不含账号信息的公开 HTTPS 插件地址。',
    plugin_url_private_network_denied: '为保护本地网络安全，不能从内网地址安装插件。',
    plugin_redirect_location_unavailable: '插件下载地址返回了无效跳转，请联系插件作者。',
    plugin_too_many_redirects: '插件下载地址跳转次数过多，请检查地址后重试。',
    plugin_package_size_invalid: '插件包大小无效或超过允许上限。',
    plugin_package_too_large: '插件包超过允许的大小上限。',
    plugin_package_size_mismatch: '插件包实际大小与发布信息不一致，已停止安装。',
    plugin_package_digest_mismatch: '插件包完整性校验失败，已停止安装。',
    plugin_download_failed: '插件下载失败，请检查网络后重试。',
    plugin_download_cancelled: '插件下载已取消。',
    plugin_download_paused: '插件下载已暂停，可在下载管理中继续。',
    plugin_download_wait_timeout: '插件下载等待超时，可在下载管理中查看进度后重试。',
    plugin_marketplace_too_large: '插件市场返回的数据超过安全大小限制。',
    plugin_marketplace_identity_mismatch: '下载的插件身份与市场信息不一致，已停止安装。',
    github_repository_invalid: 'GitHub 仓库地址格式不正确。',
    github_release_plugin_asset_missing: '最新 GitHub Release 中没有找到可安装的插件 ZIP。',
    plugin_feature_disabled: '第三方插件功能已在功能管理中关闭。',
  }
  const code = message.split(':', 1)[0]
  if (knownMessages[code]) return knownMessages[code]
  if (cause instanceof SyntaxError) return '插件市场返回的数据格式无效，请稍后重试。'
  if (/invalid url|failed to fetch|networkerror/i.test(message)) return fallback
  if (/^(?:plugin|github|download)_[a-z0-9_.-]+$/i.test(code)) return fallback
  return message
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function pluginCodeBytes(record: InstalledPluginRecord): number {
  const size = (version: InstalledPluginRecord | NonNullable<InstalledPluginRecord['previousVersions']>[number]) =>
    version.unpackedBytes ?? version.manifest.files.reduce((total, file) => total + file.size, 0)
  return size(record) + (record.previousVersions ?? []).reduce((total, version) => total + size(version), 0)
}

interface PluginActivityEntry {
  at?: number
  event?: string
  capability?: string
  toolName?: string
  toolId?: string
  method?: string
  backend?: string
  status?: string
  errorCode?: string
  reason?: string
  message?: string
  failures?: string[]
}

function activityTitle(entry: PluginActivityEntry): string {
  if (entry.event === 'grant')
    return `已授权 ${CAPABILITY_LABELS[entry.capability ?? ''] ?? entry.capability ?? '能力'}`
  if (entry.event === 'revoke')
    return `已撤销 ${CAPABILITY_LABELS[entry.capability ?? ''] ?? entry.capability ?? '能力'}`
  if (entry.event === 'runtime_started') return '插件运行环境已启动'
  if (entry.event === 'runtime_start_failed') return '插件启动失败'
  if (entry.event === 'invocation_succeeded') return `调用成功：${entry.toolName ?? '插件工具'}`
  if (entry.event === 'invocation_failed') return `调用失败：${entry.toolName ?? '插件工具'}`
  if (entry.event === 'invocation_denied' || entry.event === 'capability_denied') return '插件请求已拒绝'
  if (entry.event === 'uninstall_incomplete') return '卸载存在残留'
  if (entry.event === 'view_render_failed') return '插件页面渲染失败'
  if (entry.event) return entry.event
  return entry.toolName ?? entry.toolId ?? entry.method ?? '插件活动'
}

function activityDetail(entry: PluginActivityEntry): string {
  const details = [
    entry.status,
    entry.backend,
    entry.errorCode,
    entry.reason,
    entry.message,
    entry.failures?.join('; '),
  ]
    .filter(Boolean)
    .join(' · ')
  if (details) return details
  return [entry.status, entry.backend, entry.errorCode].filter(Boolean).join(' · ') || '已记录'
}

/** Per-plugin detail: grant panel with immediate revoke, health status, bounded activity log. */
function PluginDetail({ record, onChanged }: { record: InstalledPluginRecord; onChanged: () => Promise<void> }) {
  const [grants, setGrants] = useState<Array<{ capability: string; state: string; domains?: string[] }>>([])
  const [health, setHealth] = useState<PluginHealth | null>(null)
  const [audit, setAudit] = useState<PluginActivityEntry[]>([])
  const [showAllAudit, setShowAllAudit] = useState(false)
  const [deviceWarningOpen, setDeviceWarningOpen] = useState(false)
  const [deviceRiskAccepted, setDeviceRiskAccepted] = useState(false)
  const rollback = usePluginStore((state) => state.rollback)

  const reload = async () => {
    setGrants(await getPluginGrants(record))
    setHealth(await pluginHealthStore.get(record.manifest.id))
    const entries = [
      ...readPluginAudit(record.manifest.id, 100),
      ...readAgentAudit({ pluginId: record.manifest.id, limit: 100 }),
    ] as PluginActivityEntry[]
    setAudit(entries.sort((left, right) => (right.at ?? 0) - (left.at ?? 0)).slice(0, 100))
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.manifest.id])

  return (
    <Stack gap="sm" mt="sm">
      {health?.disabledReason && (
        <Alert color="red" title="已自动禁用">
          <Group justify="space-between">
            <Text size="sm">
              {health.disabledReason}
              {health.lastError ? ` · 最近错误: ${health.lastError}` : ''}
            </Text>
            <Button size="compact-sm" onClick={() => void reenableDisabledPlugin(record.manifest.id).then(reload)}>
              重新启用
            </Button>
          </Group>
        </Alert>
      )}
      <Text size="sm" fw={600}>
        能力授权
      </Text>
      <Text size="xs" c="dimmed">
        插件运行在独立的执行环境中,无法直接调用系统能力;它只能使用你在这里授权的能力。撤销立即生效。
      </Text>
      {grants.map((grant) => {
        const declared = record.manifest.capabilities.find((c) => c.name === grant.capability)
        const isDevice = grant.capability === 'device'
        const unavailable = !isPluginCapabilityImplemented(grant.capability)
        const requiresTrustedSignature = isDevice && !record.deviceGrantAllowed
        return (
          <div
            key={grant.capability}
            style={
              isDevice ? { border: '1px solid var(--mantine-color-red-4)', borderRadius: 8, padding: 8 } : undefined
            }
          >
            <Group justify="space-between" align="flex-start">
              <div style={{ flex: 1 }}>
                <Text size="sm" fw={isDevice ? 650 : 500} c={isDevice ? 'red' : undefined}>
                  {CAPABILITY_LABELS[grant.capability] ?? grant.capability}
                </Text>
                <Text size="xs" c="dimmed">
                  {declared?.reason}
                </Text>
                {grant.capability === 'sandbox' && (
                  <Text size="xs" c="orange">
                    可执行命令、联网并修改共享 PRoot 系统镜像；PRoot 不是安全隔离边界。只向可信插件授权。
                  </Text>
                )}
                {grant.domains && (
                  <Text size="xs" c="dimmed">
                    允许的域名: {grant.domains.join(', ')}
                  </Text>
                )}
                {(unavailable || requiresTrustedSignature) && (
                  <Text size="xs" c="red">
                    {requiresTrustedSignature
                      ? '设备控制只对市场验签通过的插件开放；本地侧载和未签名插件不能获得此能力。'
                      : '当前版本尚未开放此能力。'}
                  </Text>
                )}
              </div>
              <Switch
                checked={grant.state === 'granted'}
                disabled={unavailable || requiresTrustedSignature}
                onChange={(event) => {
                  const checked = event.currentTarget.checked
                  if (isDevice && checked) {
                    setDeviceRiskAccepted(false)
                    setDeviceWarningOpen(true)
                    return
                  }
                  void setPluginGrant(record, grant.capability, checked).then(reload)
                }}
              />
            </Group>
          </div>
        )
      })}
      <Modal
        opened={deviceWarningOpen}
        onClose={() => setDeviceWarningOpen(false)}
        title="授予第三方插件设备控制"
        centered
      >
        <Stack gap="sm">
          <Alert color="red" title="此权限风险极高">
            授权了设备权限的第三方插件，能做的事和恶意软件没有本质区别。只应向你完全信任的插件授予。
          </Alert>
          <Text size="sm">
            此插件将能够读取当前屏幕上的全部文字内容（包括其他应用里的）、点击和滚动界面元素、代你输入文字、
            启动任意已安装应用，以及按下返回、主屏和最近任务等系统按键。
          </Text>
          <Code block>
            {`插件 ID: ${record.manifest.id}\n版本: ${record.manifest.version}\n签名: ${record.signatureVerified ? '已验证' : '未验证'}\n申请理由: ${record.manifest.capabilities.find((item) => item.name === 'device')?.reason ?? ''}`}
          </Code>
          <Checkbox
            checked={deviceRiskAccepted}
            onChange={(event) => setDeviceRiskAccepted(event.currentTarget.checked)}
            label="我理解此插件可以控制手机并读取其他应用界面，仍然要授予"
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeviceWarningOpen(false)}>
              取消
            </Button>
            <Button
              color="red"
              disabled={!deviceRiskAccepted || !record.deviceGrantAllowed}
              onClick={() =>
                void setPluginGrant(record, 'device', true).then(async () => {
                  setDeviceWarningOpen(false)
                  await reload()
                })
              }
            >
              授予设备控制
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          活动日志
        </Text>
        {audit.length > 6 && (
          <Button size="compact-xs" variant="subtle" onClick={() => setShowAllAudit((value) => !value)}>
            {showAllAudit ? '仅看最近' : '查看全部'}
          </Button>
        )}
      </Group>
      {audit.length === 0 ? (
        <Text size="xs" c="dimmed">
          暂无记录
        </Text>
      ) : (
        <List listStyleType="none" spacing={6} style={{ maxHeight: showAllAudit ? 360 : 190, overflowY: 'auto' }}>
          {audit.slice(0, showAllAudit ? 100 : 6).map((entry, index) => (
            <List.Item key={`${entry.at ?? 0}:${entry.event ?? entry.toolName ?? entry.toolId ?? index}`}>
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Text size="xs" fw={600} lineClamp={1}>
                    {activityTitle(entry)}
                  </Text>
                  <Text size="xs" c={entry.status === 'denied' || entry.errorCode ? 'red' : 'dimmed'} lineClamp={2}>
                    {activityDetail(entry)}
                  </Text>
                </div>
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                  {entry.at ? new Date(entry.at).toLocaleString() : '时间未知'}
                </Text>
              </Group>
            </List.Item>
          ))}
        </List>
      )}
      {(record.previousVersions?.length ?? 0) > 0 && (
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            可回退版本
          </Text>
          {record.previousVersions?.map((version) => (
            <Group key={`${version.manifest.version}:${version.packageSha256}`} justify="space-between">
              <Text size="xs">v{version.manifest.version}</Text>
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<IconArrowBackUp size={13} />}
                onClick={() => void rollback(record.manifest.id, version.manifest.version).then(onChanged)}
              >
                回退
              </Button>
            </Group>
          ))}
          <Text size="xs" c="dimmed">
            回退后所有能力会撤销，需要重新逐项授权。
          </Text>
        </Stack>
      )}
    </Stack>
  )
}

export function PluginCenter() {
  const inAndroidAppShell = useInAndroidAppShell()
  const installed = usePluginStore((state) => state.installed)
  const pendingConsent = usePluginStore((state) => state.pendingConsent)
  const refresh = usePluginStore((state) => state.refresh)
  const requestInstall = usePluginStore((state) => state.requestInstall)
  const confirmInstall = usePluginStore((state) => state.confirmInstall)
  const cancelInstall = usePluginStore((state) => state.cancelInstall)
  const uninstall = usePluginStore((state) => state.uninstall)
  const setEnabled = usePluginStore((state) => state.setEnabled)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [granted, setGranted] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [sourceUrl, setSourceUrl] = useState('')
  const [marketplace, setMarketplace] = useState<PluginMarketplaceEntry[] | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [availableUpdates, setAvailableUpdates] = useState<Map<string, PluginMarketplaceEntry>>(new Map())
  const [pluginStats, setPluginStats] = useState<Record<string, { dataBytes: number; health: PluginHealth | null }>>({})
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [uninstallTarget, setUninstallTarget] = useState<InstalledPluginRecord | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let active = true
    void Promise.all([
      platform.getVersion().catch(() => null),
      Promise.all(
        installed.map(async (record) => [
          record.manifest.id,
          {
            dataBytes: await pluginDataStore.usedBytes(`plugin:${record.manifest.id}:`),
            health: await pluginHealthStore.get(record.manifest.id),
          },
        ] as const),
      ),
    ]).then(([version, entries]) => {
      if (!active) return
      setAppVersion(version)
      setPluginStats(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
  }, [installed])

  useEffect(() => {
    // Capability consent is explicit. Installation never preselects authority on the user's behalf.
    if (pendingConsent) {
      setGranted(pendingConsent.preservedCapabilities)
    }
  }, [pendingConsent])

  const installFromFile = async (file: File | null) => {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      if (file.size > PLUGIN_PACKAGE_LIMITS.maxArchiveBytes) throw new Error('插件包过大')
      // Sideload warning is part of the consent sheet below; source marks it unsigned-by-default.
      await requestInstall(new Uint8Array(await file.arrayBuffer()), 'sideload')
    } catch (requestError) {
      setError(pluginCenterErrorMessage(requestError, '插件包无效，请检查文件后重试。'))
    } finally {
      setBusy(false)
    }
  }

  const installFromUrl = async () => {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const originalUrl = new URL(sourceUrl.trim()).toString()
      const source = await resolvePluginPackageSource(originalUrl)
      const request = await pluginPackageDownloadRequest(source, '第三方插件')
      savePendingPluginInstall({
        schemaVersion: 1,
        state: 'prepared',
        request,
        source: 'https',
        ...(source.sha256 ? { expectedSha256: source.sha256 } : {}),
        updateSource: { kind: 'url', url: originalUrl },
        createdAt: Date.now(),
      })
      const downloaded = await downloadPluginPackage(source, '第三方插件')
      try {
        await requestInstall(downloaded.bytes, 'https', {
          ...(source.sha256 ? { expectedSha256: source.sha256 } : {}),
          updateSource: { kind: 'url', url: originalUrl },
          artifactId: downloaded.downloadId,
        })
      } catch (error) {
        clearPendingPluginInstall(downloaded.downloadId)
        await downloaded.cleanup().catch(() => {})
        throw error
      }
    } catch (requestError) {
      setError(pluginCenterErrorMessage(requestError, '插件下载或校验失败，请检查地址后重试。'))
    } finally {
      setBusy(false)
    }
  }

  const installMarketplaceEntry = async (
    entry: PluginMarketplaceEntry,
    marketplaceUrl = DEFAULT_PLUGIN_MARKETPLACE_URL,
  ) => {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const source = marketplacePackage(entry)
      const request = await pluginPackageDownloadRequest(source, entry.name)
      savePendingPluginInstall({
        schemaVersion: 1,
        state: 'prepared',
        request,
        source: 'marketplace',
        expectedSha256: entry.sha256,
        signature: entry.signature,
        updateSource: { kind: 'marketplace', url: marketplaceUrl },
        expectedPlugin: { id: entry.id, version: entry.version },
        createdAt: Date.now(),
      })
      const downloaded = await downloadPluginPackage(source, entry.name)
      try {
        await requestInstall(downloaded.bytes, 'marketplace', {
          expectedSha256: entry.sha256,
          signature: entry.signature,
          updateSource: { kind: 'marketplace', url: marketplaceUrl },
          artifactId: downloaded.downloadId,
        })
        const inspected = usePluginStore.getState().pendingConsent?.verified.manifest
        if (!inspected || inspected.id !== entry.id || inspected.version !== entry.version) {
          await usePluginStore.getState().cancelInstall()
          throw new Error('plugin_marketplace_identity_mismatch')
        }
      } catch (error) {
        clearPendingPluginInstall(downloaded.downloadId)
        await downloaded.cleanup().catch(() => {})
        throw error
      }
    } catch (requestError) {
      setError(pluginCenterErrorMessage(requestError, '市场插件安装失败，请稍后重试。'))
    } finally {
      setBusy(false)
    }
  }

  const checkAllUpdates = async () => {
    setError(null)
    setNotice(null)
    setMarketLoading(true)
    try {
      const catalogUrls = new Set(
        installed
          .filter((record) => record.source === 'marketplace' || record.updateSource?.kind === 'marketplace')
          .map((record) => record.updateSource?.url ?? DEFAULT_PLUGIN_MARKETPLACE_URL),
      )
      const updates = new Map<string, PluginMarketplaceEntry>()
      for (const catalogUrl of catalogUrls) {
        const entries = await loadPluginMarketplace(catalogUrl)
        const records = installed.filter(
          (record) => (record.updateSource?.url ?? DEFAULT_PLUGIN_MARKETPLACE_URL) === catalogUrl,
        )
        for (const [id, entry] of findMarketplacePluginUpdates(records, entries)) updates.set(id, entry)
      }
      setAvailableUpdates(updates)
      const manualCount = installed.filter(
        (record) => record.source !== 'marketplace' && record.updateSource?.kind !== 'marketplace',
      ).length
      setNotice(
        updates.size > 0
          ? `发现 ${updates.size} 个可用更新。${manualCount > 0 ? `另有 ${manualCount} 个非市场插件需单独检查。` : ''}`
          : `市场插件均为最新版本。${manualCount > 0 ? `另有 ${manualCount} 个非市场插件需单独检查。` : ''}`,
      )
    } catch (checkError) {
      setError(pluginCenterErrorMessage(checkError, '插件更新检查失败，请稍后重试。'))
    } finally {
      setMarketLoading(false)
    }
  }

  const checkOneUpdate = async (record: InstalledPluginRecord) => {
    setError(null)
    setNotice(null)
    if (record.source === 'marketplace' || record.updateSource?.kind === 'marketplace') {
      setMarketLoading(true)
      try {
        const catalogUrl = record.updateSource?.url ?? DEFAULT_PLUGIN_MARKETPLACE_URL
        const entries = await loadPluginMarketplace(catalogUrl)
        const candidate = findMarketplacePluginUpdates([record], entries).get(record.manifest.id)
        if (!candidate) {
          setNotice(`${record.manifest.displayName} 已是最新版本。`)
          return
        }
        setAvailableUpdates((previous) => new Map(previous).set(record.manifest.id, candidate))
        await installMarketplaceEntry(candidate, catalogUrl)
      } catch (checkError) {
        setError(pluginCenterErrorMessage(checkError, '插件更新检查失败，请稍后重试。'))
      } finally {
        setMarketLoading(false)
      }
      return
    }
    if (record.updateSource?.kind === 'url') {
      setBusy(true)
      try {
        const source = await resolvePluginPackageSource(record.updateSource.url)
        const request = await pluginPackageDownloadRequest(source, `${record.manifest.displayName} 更新检查`)
        savePendingPluginInstall({
          schemaVersion: 1,
          state: 'prepared',
          request,
          source: 'https',
          ...(source.sha256 ? { expectedSha256: source.sha256 } : {}),
          updateSource: record.updateSource,
          createdAt: Date.now(),
        })
        const downloaded = await downloadPluginPackage(source, `${record.manifest.displayName} 更新检查`)
        try {
          await requestInstall(downloaded.bytes, 'https', {
            ...(source.sha256 ? { expectedSha256: source.sha256 } : {}),
            updateSource: record.updateSource,
            artifactId: downloaded.downloadId,
          })
        } catch (error) {
          clearPendingPluginInstall(downloaded.downloadId)
          await downloaded.cleanup().catch(() => {})
          throw error
        }
      } catch (checkError) {
        const message = checkError instanceof Error ? checkError.message : '插件更新检查失败'
        if (/already installed/i.test(message)) setNotice(`${record.manifest.displayName} 已是最新版本。`)
        else setError(pluginCenterErrorMessage(checkError, '插件更新检查失败，请稍后重试。'))
      } finally {
        setBusy(false)
      }
      return
    }
    setNotice('这个旧版侧载插件没有可验证的更新来源，请手动选择更新包。')
  }

  const uninstallPlugin = async (record: InstalledPluginRecord) => {
    setError(null)
    setBusy(true)
    try {
      await uninstall(record.manifest.id)
    } catch (uninstallError) {
      setError(
        pluginCenterErrorMessage(
          uninstallError,
          '卸载未完全完成。插件已停止并移除权限，但仍有文件或数据残留，请稍后重试。'
        )
      )
    } finally {
      setBusy(false)
    }
  }

  const manifest = pendingConsent?.verified.manifest
  const updating = manifest ? installed.find((record) => record.manifest.id === manifest.id) : undefined
  const updateChanges =
    updating && manifest
      ? describePluginUpdate(updating, manifest, pendingConsent?.verified.signerKeyId)
      : null

  return (
    <main className="local-model-center local-model-download-queue">
      <header className="local-model-queue-heading">
        <Group justify="space-between" gap="sm" wrap="wrap" w="100%">
          <Group gap="sm">
            {!inAndroidAppShell && (
              <ActionIcon variant="subtle" aria-label="返回设置" onClick={() => void router.navigate({ to: '/settings' })}>
                <IconArrowLeft />
              </ActionIcon>
            )}
            <div>
              <Title order={2}>插件</Title>
              <Text size="sm" c="dimmed">
                安装并管理第三方插件，系统能力均通过受控接口调用
              </Text>
            </div>
          </Group>
          {installed.length > 0 && (
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<IconRefresh size={15} />}
              loading={marketLoading}
              onClick={() => void checkAllUpdates()}
            >
              检查全部更新
            </Button>
          )}
        </Group>
      </header>

      <section className="local-model-queue-row">
        <Stack gap="xs">
          <Text fw={650}>安装插件</Text>
          <Group align="flex-end">
            <TextInput
              style={{ flex: '1 1 190px' }}
              label="HTTPS 或 GitHub 地址"
              placeholder="https://github.com/owner/plugin"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.currentTarget.value)}
            />
            <Button
              leftSection={<IconBrandGithub size={15} />}
              loading={busy}
              disabled={!sourceUrl.trim()}
              onClick={() => void installFromUrl()}
            >
              下载并检查
            </Button>
          </Group>
          <Group gap="xs">
            <FileButton accept=".zip,application/zip" onChange={(file) => void installFromFile(file)}>
              {(props) => (
                <Button variant="default" leftSection={<IconUpload size={15} />} loading={busy} {...props}>
                  从 ZIP 侧载
                </Button>
              )}
            </FileButton>
            <Button
              variant="default"
              leftSection={<IconRefresh size={15} />}
              loading={marketLoading}
              onClick={() => {
                setMarketLoading(true)
                setError(null)
                void loadPluginMarketplace()
                  .then(setMarketplace)
                  .catch((marketError) =>
                    setError(pluginCenterErrorMessage(marketError, '插件市场加载失败，请稍后重试。'))
                  )
                  .finally(() => setMarketLoading(false))
              }}
            >
              浏览插件市场
            </Button>
          </Group>
          {error && (
            <Text size="xs" c="red" role="alert">
              {error}
            </Text>
          )}
          {notice && (
            <Text size="xs" c="dimmed" role="status">
              {notice}
            </Text>
          )}
        </Stack>
      </section>

      {marketplace && (
        <section className="local-model-queue-row">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={650}>插件市场</Text>
              <Badge variant="light">{marketplace.length}</Badge>
            </Group>
            {marketplace.length === 0 && (
              <Text size="sm" c="dimmed">
                市场暂时没有已验签的插件。
              </Text>
            )}
            {marketplace.map((entry) => (
              <Group key={`${entry.id}:${entry.version}`} justify="space-between" align="flex-start" wrap="wrap">
                <div style={{ flex: '1 1 190px' }}>
                  <Text size="sm" fw={600}>
                    {entry.name}{' '}
                    <Text span size="xs" c="dimmed">
                      v{entry.version}
                    </Text>
                  </Text>
                  <Text size="xs" c="dimmed">
                    {entry.description}
                  </Text>
                </div>
                <Button
                  size="compact-sm"
                  leftSection={<IconDownload size={14} />}
                  loading={busy}
                  onClick={() => void installMarketplaceEntry(entry)}
                >
                  安装
                </Button>
              </Group>
            ))}
          </Stack>
        </section>
      )}

      {installed.length === 0 && (
        <Text c="dimmed" ta="center" py="md">
          尚未安装任何插件
        </Text>
      )}

      {installed.map((record) => {
        const stats = pluginStats[record.manifest.id]
        const compatible = appVersion ? isPluginCompatible(record.manifest, appVersion) : true
        const status = !compatible
          ? { label: '不兼容', color: 'red' }
          : stats?.health?.disabledReason
            ? { label: '连续失败已禁用', color: 'red' }
            : record.enabled === false
              ? { label: '已停用', color: 'gray' }
              : { label: '正常', color: 'green' }
        const signerLabel = record.signerKeyId?.split(':')[0]?.slice(0, 24)
        const available = availableUpdates.get(record.manifest.id)
        return (
          <section key={record.manifest.id} className="local-model-queue-row">
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <div style={{ flex: '1 1 190px', minWidth: 0 }}>
                  <Text fw={650} lineClamp={1} title={record.manifest.displayName}>
                    <IconPuzzle size={15} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} />
                    {record.manifest.displayName}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
                    {record.manifest.id} · v{record.manifest.version} · {record.manifest.author?.name ?? '作者未声明'}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2} style={{ overflowWrap: 'anywhere' }}>
                    {SOURCE_LABELS[record.source] ?? record.source} ·{' '}
                    {record.signatureVerified ? `签名者 ${signerLabel ?? '已验证'}` : '无法验证作者与下载完整性'}
                  </Text>
                  <Text size="xs" c="dimmed">
                    代码 {formatBytes(pluginCodeBytes(record))} · 数据 {formatBytes(stats?.dataBytes ?? 0)}
                  </Text>
                </div>
                <Group gap={6} wrap="wrap" justify="flex-end">
                  {available && <Badge color="chatbox-brand">可更新至 v{available.version}</Badge>}
                  <Badge color={status.color} size="sm">
                    {status.label}
                  </Badge>
                  <Badge color={record.signatureVerified ? 'green' : 'yellow'} size="sm">
                    {record.signatureVerified ? '已验签' : '未签名'}
                  </Badge>
                </Group>
              </Group>
              <Group gap="xs" justify="flex-end" wrap="wrap">
                <Switch
                  size="sm"
                  label={record.enabled === false ? '已停用' : '已启用'}
                  checked={record.enabled !== false}
                  onChange={(event) => void setEnabled(record.manifest.id, event.currentTarget.checked)}
                />
                {(record.updateSource || record.source === 'marketplace') && (
                  <Button
                    size="compact-sm"
                    variant="default"
                    leftSection={<IconRefresh size={14} />}
                    loading={busy || marketLoading}
                    onClick={() => void checkOneUpdate(record)}
                  >
                    {available ? '查看更新' : '检查更新'}
                  </Button>
                )}
                <FileButton accept=".zip,application/zip" onChange={(file) => void installFromFile(file)}>
                  {(props) => (
                    <Button size="compact-sm" variant="default" leftSection={<IconUpload size={14} />} loading={busy} {...props}>
                      更新包
                    </Button>
                  )}
                </FileButton>
                <Button
                  size="compact-sm"
                  variant="default"
                  onClick={() => setDetailId(detailId === record.manifest.id ? null : record.manifest.id)}
                >
                  {detailId === record.manifest.id ? '收起' : '权限与活动'}
                </Button>
                <Button
                  disabled={record.enabled === false || !compatible}
                  size="compact-sm"
                  variant="default"
                  onClick={() =>
                    void router.navigate({ to: '/plugin/$pluginId', params: { pluginId: record.manifest.id } })
                  }
                >
                  打开
                </Button>
                <ActionIcon
                  color="red"
                  variant="subtle"
                  aria-label={`卸载插件 ${record.manifest.displayName}`}
                  onClick={() => setUninstallTarget(record)}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            </Stack>
            {detailId === record.manifest.id && <PluginDetail record={record} onChanged={refresh} />}
          </section>
        )
      })}

      <Modal
        opened={uninstallTarget !== null}
        onClose={() => setUninstallTarget(null)}
        title="卸载插件"
        centered
      >
        {uninstallTarget && (
          <Stack gap="sm">
            <Text size="sm">
              卸载“{uninstallTarget.manifest.displayName}”会删除所有版本的插件代码、插件数据、凭据和授权记录；
              为了安全追溯，活动审计会保留。
            </Text>
            <Text size="xs" c="dimmed">
              如果只是暂时不使用，可以停用插件并保留数据。
            </Text>
            <Group justify="flex-end" gap="xs" wrap="wrap">
              <Button variant="default" onClick={() => setUninstallTarget(null)}>
                取消
              </Button>
              <Button
                variant="default"
                onClick={() =>
                  void setEnabled(uninstallTarget.manifest.id, false).then(() => setUninstallTarget(null))
                }
              >
                仅停用并保留数据
              </Button>
              <Button
                color="red"
                loading={busy}
                onClick={() =>
                  void uninstallPlugin(uninstallTarget).finally(() => setUninstallTarget(null))
                }
              >
                删除并卸载
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={pendingConsent !== null}
        onClose={cancelInstall}
        title={updating ? '更新插件' : '安装插件'}
        centered
      >
        {manifest && (
          <Stack gap="sm">
            <div>
              <Text fw={650}>
                {manifest.displayName}{' '}
                <Text span size="sm" c="dimmed">
                  v{manifest.version}
                </Text>
              </Text>
              <Text size="sm" c="dimmed">
                {manifest.description}
              </Text>
            </div>
            {updating && (
              <Alert color="blue" title={`v${updating.manifest.version} → v${manifest.version}`}>
                <Stack gap={4}>
                  <Text size="sm">更新由你确认后才会安装，不会自动运行新代码。</Text>
                  {updateChanges?.capabilityChanges.added.map((capability) => (
                    <Text key={`added:${capability}`} size="xs" c="red">
                      新增能力：{CAPABILITY_LABELS[capability] ?? capability}，需要重新授权
                    </Text>
                  ))}
                  {updateChanges?.capabilityChanges.expandedDomains.map((domain) => (
                    <Text key={`domain:${domain}`} size="xs" c="red">
                      新增联网域名：{domain}，网络授权将失效
                    </Text>
                  ))}
                  {(updateChanges?.capabilityChanges.removed.length ?? 0) > 0 && (
                    <Text size="xs" c="dimmed">
                      移除能力：{updateChanges?.capabilityChanges.removed.map((item) => CAPABILITY_LABELS[item] ?? item).join('、')}
                    </Text>
                  )}
                  <Text size="xs" c={updateChanges?.signerChanged ? 'red' : 'dimmed'}>
                    发布者签名：{updateChanges?.signerChanged ? '已变化，原授权不会继承' : '与当前版本一致'}
                  </Text>
                  <Text size="xs" c="dimmed">设备控制授权无论能力是否变化都会撤销。</Text>
                </Stack>
              </Alert>
            )}
            {!pendingConsent?.verified.signatureVerified && (
              <Alert color="yellow" title="无法验证发布者">
                {pendingConsent?.verified.source === 'sideload'
                  ? '无法验证这个插件来自它声称的作者，也无法确认它在传递过程中没有被替换。请只安装你能独立核对来源的文件。'
                  : '无法验证这个插件来自它声称的作者，也无法确认它在下载过程中没有被替换。HTTPS 只保护连接，不证明作者身份。'}
              </Alert>
            )}
            {manifest.entry && (
              <Alert color="orange" title="此插件包含可执行代码">
                插件脚本会在受限 Worker 中运行，但该环境不是独立虚拟机。只安装来源可信、用途明确的插件。
              </Alert>
            )}
            {manifest.capabilities.length > 0 ? (
              <Stack gap={6}>
                <Text size="sm" fw={600}>
                  请求的能力
                </Text>
                {manifest.capabilities.map((capability) => {
                  const capabilityBlocked =
                    !isPluginCapabilityImplemented(capability.name) || capability.name === 'device'
                  return (
                    <div key={capability.name}>
                      <Checkbox
                        label={CAPABILITY_LABELS[capability.name] ?? capability.name}
                        checked={!capabilityBlocked && granted.includes(capability.name)}
                        disabled={capabilityBlocked}
                        onChange={(event) => {
                          // React clears currentTarget after this callback; capture before the state updater runs.
                          const checked = event.currentTarget.checked
                          setGranted((previous) =>
                            checked
                              ? [...previous, capability.name]
                              : previous.filter((name) => name !== capability.name)
                          )
                        }}
                      />
                      <Text size="xs" c="dimmed" pl={30}>
                        {capability.reason}
                        {capability.domains ? ` · 域名: ${capability.domains.join(', ')}` : ''}
                        {capability.name === 'sandbox'
                          ? ' ·（可执行命令并修改共享 PRoot 系统镜像，仅向可信插件授权）'
                          : ''}
                        {capability.name === 'device'
                          ? ' ·（安装后需在插件详情中单独授权，且仅支持已验签插件）'
                          : capabilityBlocked
                            ? ' ·（当前版本尚未开放此第三方能力）'
                            : ''}
                      </Text>
                    </div>
                  )
                })}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                此插件未请求任何能力。
              </Text>
            )}
            <Group justify="flex-end" gap="xs">
              <Button variant="default" onClick={cancelInstall}>
                取消
              </Button>
              <Button
                loading={busy}
                onClick={() => {
                  setBusy(true)
                  void confirmInstall(granted)
                    .catch((confirmError) =>
                      setError(pluginCenterErrorMessage(confirmError, '插件安装失败，请检查插件包后重试。'))
                    )
                    .finally(() => setBusy(false))
                }}
              >
                {updating ? '确认更新' : '安装'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </main>
  )
}
