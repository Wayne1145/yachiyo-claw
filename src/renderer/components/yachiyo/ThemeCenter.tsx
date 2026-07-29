import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import {
  MAX_THEME_MANIFEST_BYTES,
  parseThemeManifestText,
  resolveThemeVariables,
  type ThemeManifest,
} from '@shared/themes/theme'
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconLink,
  IconPalette,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react'
import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { router } from '@/router'
import { BUILT_IN_LIQUID_GLASS_THEME_ID, useThemeStore } from '@/stores/themeStore'
import { consumeRecoveredThemeImport, downloadRemoteTheme } from '@/themes/remote-theme'
import { AdaptiveActionCluster, type AdaptiveActionDescriptor } from './AdaptiveActionCluster'
import { useInAndroidAppShell } from './AndroidAppShellContext'

const MODE_LABEL_KEYS: Record<ThemeManifest['mode'], string> = { light: '浅色', dark: '深色', both: '浅色 / 深色' }

function swatches(theme: ThemeManifest): string[] {
  const scheme = theme.mode === 'dark' ? 'dark' : 'light'
  const variables = resolveThemeVariables(theme, scheme)
  const priority = [
    '--chatbox-tint-brand',
    '--chatbox-background-primary',
    '--chatbox-tint-primary',
    '--chatbox-tint-success',
    '--chatbox-tint-error',
  ]
  const picked = priority.map((key) => variables[key]).filter(Boolean)
  return (picked.length ? picked : Object.values(variables)).slice(0, 6)
}

function themeErrorMessage(cause: unknown, t: TFunction): string {
  if (!(cause instanceof Error)) return t('主题清单无效，请检查文件后重试')
  const message = cause.message
  if (/exceeds/i.test(message)) return t('主题文件不能超过 {{size}} KB', { size: MAX_THEME_MANIFEST_BYTES / 1024 })
  if (/not valid JSON|JSON-serializable/i.test(message)) return t('主题文件不是有效的 JSON')
  if (/not a valid CSS color|unsafe/i.test(message)) return t('主题包含无效或不安全的颜色值')
  if (/Unknown theme token/i.test(message)) return t('主题包含当前版本不支持的颜色项目')
  if (/schemaVersion/i.test(message)) return t('主题清单版本不受支持')
  if (/dual-mode|light tokens|dark tokens/i.test(message)) return t('主题缺少对应的浅色或深色配色')
  if (/public_https|private_network|Invalid URL/i.test(message)) return t('仅支持不含账号信息的公开 HTTPS 主题地址')
  if (/size_invalid|exceeds|too_large|size_mismatch/i.test(message))
    return t('主题文件不能超过 {{size}} KB', { size: MAX_THEME_MANIFEST_BYTES / 1024 })
  if (/download_http|probe_http/i.test(message)) return t('主题下载失败，请检查地址或网络后重试')
  return t('主题清单无效，请检查名称、标识、版本和配色内容')
}

export function ThemeCenter() {
  const { t } = useTranslation()
  const inAndroidAppShell = useInAndroidAppShell()
  const installed = useThemeStore((state) => state.installed)
  const activeThemeId = useThemeStore((state) => state.activeThemeId)
  const previewingTheme = useThemeStore((state) => state.previewingTheme)
  const install = useThemeStore((state) => state.install)
  const remove = useThemeStore((state) => state.remove)
  const setActive = useThemeStore((state) => state.setActive)
  const preview = useThemeStore((state) => state.preview)
  const clearPreview = useThemeStore((state) => state.clearPreview)
  const [draft, setDraft] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ThemeManifest | null>(null)

  useEffect(() => () => clearPreview(), [clearPreview])

  useEffect(() => {
    const recovered = consumeRecoveredThemeImport()
    if (!recovered) return
    try {
      const parsed = parseThemeManifestText(recovered)
      setDraft(recovered)
      preview(parsed)
    } catch (recoveryError) {
      setError(themeErrorMessage(recoveryError, t))
    }
  }, [preview, t])

  const installFromText = (text: string) => {
    setError(null)
    try {
      const parsed = parseThemeManifestText(text)
      const theme = install(parsed)
      setActive(theme.id)
      setDraft('')
    } catch (installError) {
      setError(themeErrorMessage(installError, t))
    }
  }

  const previewFromText = (text: string) => {
    setError(null)
    try {
      preview(parseThemeManifestText(text))
    } catch (previewError) {
      clearPreview()
      setError(themeErrorMessage(previewError, t))
    }
  }

  const loadFromFile = async (file: File | null) => {
    if (!file) return
    setError(null)
    if (file.size > MAX_THEME_MANIFEST_BYTES) {
      setError(t('主题文件不能超过 {{size}} KB', { size: MAX_THEME_MANIFEST_BYTES / 1024 }))
      return
    }
    try {
      const text = await file.text()
      const parsed = parseThemeManifestText(text)
      setDraft(text)
      preview(parsed)
    } catch (fileError) {
      clearPreview()
      setError(themeErrorMessage(fileError, t))
    }
  }

  const loadFromUrl = async () => {
    if (!remoteUrl.trim() || remoteLoading) return
    setError(null)
    setRemoteLoading(true)
    try {
      const text = await downloadRemoteTheme(remoteUrl)
      const parsed = parseThemeManifestText(text)
      setDraft(text)
      preview(parsed)
    } catch (downloadError) {
      clearPreview()
      setError(themeErrorMessage(downloadError, t))
    } finally {
      setRemoteLoading(false)
    }
  }

  const handleDraftChange = (value: string) => {
    setDraft(value)
    setError(null)
    if (previewingTheme) clearPreview()
  }

  return (
    <main className="yachiyo-settings-subpage yachiyo-theme-center">
      <header className="yachiyo-subpage-heading">
        {!inAndroidAppShell && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size={38}
            aria-label={t('返回设置')}
            onClick={() => void router.navigate({ to: '/settings' })}
          >
            <IconArrowLeft size={21} />
          </ActionIcon>
        )}
        <span className="yachiyo-subpage-icon" aria-hidden="true">
          <IconPalette size={22} />
        </span>
        <div>
          <Title order={2}>{t('主题外观')}</Title>
          <Text size="sm" c="dimmed">
            {t('导入声明式配色，不加载脚本或外部样式')}
          </Text>
        </div>
      </header>

      <section className="yachiyo-settings-panel yachiyo-theme-import">
        <Stack gap="sm">
          <div>
            <Text fw={650}>{t('导入主题')}</Text>
            <Text size="xs" c="dimmed">
              {t('支持不超过 64 KB 的 JSON 主题清单，可先预览再安装')}
            </Text>
          </div>
          <Textarea
            value={draft}
            onChange={(event) => handleDraftChange(event.currentTarget.value)}
            placeholder={String(
              t(
                '例如 {"schemaVersion":1,"id":"sakura","name":"樱色","version":"1.0.0","mode":"light","tokens":{"tint-brand":"#d87597"}}'
              )
            )}
            aria-label={String(t('主题 JSON'))}
            autosize
            minRows={4}
            maxRows={9}
          />
          <Group gap="xs" align="flex-end" wrap="nowrap" className="yachiyo-theme-remote-row">
            <TextInput
              value={remoteUrl}
              onChange={(event) => setRemoteUrl(event.currentTarget.value)}
              label={t('从网址导入')}
              description={t('Android 下载会显示在统一下载管理中')}
              placeholder="https://example.com/yachiyo-theme.json"
              leftSection={<IconLink size={16} />}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              aria-label={String(t('远程主题地址'))}
              className="yachiyo-theme-remote-input"
            />
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              loading={remoteLoading}
              disabled={!remoteUrl.trim()}
              onClick={() => void loadFromUrl()}
            >
              {t('下载并预览')}
            </Button>
          </Group>
          {error && (
            <Text size="xs" c="red" role="alert">
              {error}
            </Text>
          )}
          <div className="yachiyo-theme-import-actions">
            <Button
              variant={previewingTheme ? 'light' : 'default'}
              leftSection={previewingTheme ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              disabled={!draft.trim()}
              onClick={() => (previewingTheme ? clearPreview() : previewFromText(draft))}
            >
              {previewingTheme ? t('结束预览') : t('预览')}
            </Button>
            <Button disabled={!draft.trim()} onClick={() => installFromText(draft)}>
              {t('安装并使用')}
            </Button>
            <FileButton accept="application/json,.json" onChange={(file) => void loadFromFile(file)}>
              {(props) => (
                <Button variant="default" leftSection={<IconUpload size={16} />} {...props}>
                  {t('选择文件')}
                </Button>
              )}
            </FileButton>
          </div>
        </Stack>
      </section>

      {previewingTheme && (
        <div className="yachiyo-theme-preview-notice" role="status">
          <IconEye size={17} />
          <span>{t('正在临时预览“{{name}}”，离开此页会自动恢复。', { name: previewingTheme.name })}</span>
          <Button size="compact-xs" variant="subtle" onClick={clearPreview}>
            {t('结束')}
          </Button>
        </div>
      )}

      <section className="yachiyo-theme-library" aria-label={String(t('已安装主题'))}>
        <Text className="yachiyo-section-label">{t('主题库')}</Text>
        <div className="yachiyo-theme-grid">
          <article className="yachiyo-theme-card" data-active={activeThemeId === null ? 'true' : 'false'}>
            <div className="yachiyo-theme-card-preview yachiyo-theme-card-preview-default">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="yachiyo-theme-card-heading">
              <div>
                <Text fw={650}>{t('Yachiyo 浅粉')}</Text>
                <Text size="xs" c="dimmed">
                  {t('内置 · 浅色')}
                </Text>
              </div>
              {activeThemeId === null && !previewingTheme && (
                <Badge color="chatbox-brand" leftSection={<IconCheck size={12} />}>
                  {t('使用中')}
                </Badge>
              )}
            </div>
            {activeThemeId !== null && (
              <Button size="compact-sm" variant="default" onClick={() => setActive(null)}>
                {t('恢复默认')}
              </Button>
            )}
          </article>

          <article
            className="yachiyo-theme-card"
            data-active={activeThemeId === BUILT_IN_LIQUID_GLASS_THEME_ID ? 'true' : 'false'}
          >
            <div className="yachiyo-theme-card-preview yachiyo-theme-card-preview-liquid">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="yachiyo-theme-card-heading">
              <div>
                <Text fw={650}>{t('Yachiyo 液态玻璃')}</Text>
                <Text size="xs" c="dimmed">
                  {t('内置 · ChatGPT 简约布局与半透明玻璃控件')}
                </Text>
              </div>
              {activeThemeId === BUILT_IN_LIQUID_GLASS_THEME_ID && !previewingTheme && (
                <Badge color="chatbox-brand" leftSection={<IconCheck size={12} />}>
                  {t('使用中')}
                </Badge>
              )}
            </div>
            {activeThemeId !== BUILT_IN_LIQUID_GLASS_THEME_ID && (
              <Button size="compact-sm" onClick={() => setActive(BUILT_IN_LIQUID_GLASS_THEME_ID)}>
                {t('使用')}
              </Button>
            )}
          </article>

          {installed.map((theme) => {
            const isActive = activeThemeId === theme.id
            const isPreviewing = previewingTheme?.id === theme.id
            const previewLabel = String(isPreviewing ? t('结束预览') : t('预览'))
            const themeActions: AdaptiveActionDescriptor[] = [
              {
                id: 'preview',
                label: previewLabel,
                icon: isPreviewing ? IconEyeOff : IconEye,
                priority: 70,
                collapseStrategy: 'icon-then-overflow',
                renderControl: ({ presentation }) =>
                  presentation === 'labelled' ? (
                    <Button
                      variant="default"
                      leftSection={isPreviewing ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                      onClick={() => (isPreviewing ? clearPreview() : preview(theme))}
                    >
                      {previewLabel}
                    </Button>
                  ) : (
                    <ActionIcon
                      size={44}
                      variant="default"
                      aria-label={`${previewLabel} ${theme.name}`}
                      onClick={() => (isPreviewing ? clearPreview() : preview(theme))}
                    >
                      {isPreviewing ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                    </ActionIcon>
                  ),
                menuAction: {
                  onSelect: () => (isPreviewing ? clearPreview() : preview(theme)),
                },
              },
              ...(!isActive
                ? [
                    {
                      id: 'activate',
                      label: String(t('使用')),
                      icon: IconCheck,
                      priority: 100,
                      collapseStrategy: 'keep' as const,
                      renderControl: () => (
                        <Button leftSection={<IconCheck size={17} />} onClick={() => setActive(theme.id)}>
                          {t('使用')}
                        </Button>
                      ),
                    },
                  ]
                : []),
              {
                id: 'delete',
                label: String(t('删除')),
                icon: IconTrash,
                priority: 10,
                collapseStrategy: 'overflow',
                renderControl: () => (
                  <ActionIcon
                    size={44}
                    color="red"
                    variant="subtle"
                    aria-label={t('删除主题 {{name}}', { name: theme.name })}
                    onClick={() => setRemoveTarget(theme)}
                  >
                    <IconTrash size={17} />
                  </ActionIcon>
                ),
                menuAction: {
                  onSelect: () => setRemoveTarget(theme),
                },
              },
            ]
            return (
              <article
                key={theme.id}
                className="yachiyo-theme-card"
                data-active={isActive ? 'true' : 'false'}
                data-previewing={isPreviewing ? 'true' : 'false'}
              >
                <div className="yachiyo-theme-card-preview">
                  {swatches(theme).map((color, index) => (
                    <span key={`${theme.id}-${index}`} style={{ background: color }} />
                  ))}
                </div>
                <div className="yachiyo-theme-card-heading">
                  <div>
                    <Text fw={650}>{theme.name}</Text>
                    <Text size="xs" c="dimmed">
                      {theme.author?.name ? `${theme.author.name} · ` : ''}v{theme.version} ·{' '}
                      {t(MODE_LABEL_KEYS[theme.mode])}
                    </Text>
                  </div>
                  {isActive && !previewingTheme && (
                    <Badge color="chatbox-brand" leftSection={<IconCheck size={12} />}>
                      {t('使用中')}
                    </Badge>
                  )}
                  {isPreviewing && (
                    <Badge variant="light" leftSection={<IconEye size={12} />}>
                      {t('预览中')}
                    </Badge>
                  )}
                </div>
                {inAndroidAppShell ? (
                  <AdaptiveActionCluster
                    className="yachiyo-theme-card-actions"
                    ariaLabel={`${theme.name} ${String(t('主题操作'))}`}
                    actions={themeActions}
                  />
                ) : (
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="compact-sm"
                        variant="default"
                        onClick={() => (isPreviewing ? clearPreview() : preview(theme))}
                      >
                        {previewLabel}
                      </Button>
                      {!isActive && (
                        <Button size="compact-sm" onClick={() => setActive(theme.id)}>
                          {t('使用')}
                        </Button>
                      )}
                    </Group>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      aria-label={t('删除主题 {{name}}', { name: theme.name })}
                      onClick={() => setRemoveTarget(theme)}
                    >
                      <IconTrash size={17} />
                    </ActionIcon>
                  </Group>
                )}
              </article>
            )
          })}
        </div>
        {installed.length === 0 && (
          <Text c="dimmed" ta="center" py="md">
            {t('尚未安装第三方主题')}
          </Text>
        )}
      </section>

      <Modal
        opened={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title={t('删除主题')}
        centered
        radius="lg"
        withCloseButton={false}
      >
        <Stack gap="md">
          <Text size="sm">{t('确定删除主题“{{name}}”？此操作无法撤销。', { name: removeTarget?.name ?? '' })}</Text>
          {removeTarget && activeThemeId === removeTarget.id && (
            <Text size="xs" c="dimmed">
              {t('当前正在使用此主题，删除后将恢复 Yachiyo 浅粉主题。')}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setRemoveTarget(null)}>
              {t('取消')}
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (!removeTarget) return
                remove(removeTarget.id)
                setRemoveTarget(null)
              }}
            >
              {t('确认删除')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </main>
  )
}
