import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  ScrollArea,
  SegmentedControl,
  Stack,
  Stepper,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import {
  IconArchive,
  IconBrandAndroid,
  IconBrowser,
  IconCheck,
  IconCode,
  IconFile,
  IconFolderOpen,
  IconGitBranch,
  IconPlayerPlay,
  IconRefresh,
  IconRobot,
  IconSend,
  IconTerminal2,
  IconX,
} from '@tabler/icons-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import {
  BUILD_TARGET_PROFILES,
  createMessage,
  getBuildTargetProfile,
  type BuildTargetId,
  type CodingBuildRun,
  type CodingChangeOperation,
  type CodingProjectRecord,
} from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import platform from '@/platform'
import { setAgentWorkingDirectory } from '@/mobile/agent-broker'
import { saveAgentSessionConfig } from '@/mobile/agent-session-config'
import { applyCodingChangeSet, rejectCodingChangeFiles, rejectCodingChangeSet } from '@/mobile/coding-changes'
import { artifactPathMatches, startCodingBuildRun } from '@/mobile/coding-builds'
import { createCodingProject, importCodingProject, inspectCodingToolchain } from '@/mobile/coding-projects'
import { codingProjectStorage } from '@/storage/CodingProjectStorage'
import { submitTaskMessage } from '@/stores/taskSessionActions'
import { taskSessionStore, useTaskSessionRecord } from '@/stores/taskSessionStore'
import {
  useCodingArtifacts,
  useCodingBuildRuns,
  useCodingChangeSets,
  useCodingProject,
  useCodingProjects,
} from '@/stores/codingProjectStore'
import type { NativeApkInspection } from '@/platform/native/yachiyo_artifact'
import './coding-workspace.css'

const CREATE_TARGETS: BuildTargetId[] = ['web-static', 'web-vite', 'web-pwa', 'android-capacitor', 'android-kotlin']

function supportLabelKey(level: string) {
  if (level === 'stable') return '正式支持'
  if (level === 'beta') return 'Beta'
  if (level === 'source-only') return '仅源码'
  return '需要远程构建'
}

export function CodingHome() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data: projects = [], refetch } = useCodingProjects()
  const [opened, setOpened] = useState(false)
  const [wizardStep, setWizardStep] = useState(0)
  const [targetId, setTargetId] = useState<BuildTargetId>('web-static')
  const [name, setName] = useState('My project')
  const [packageName, setPackageName] = useState('com.example.myapp')
  const [busy, setBusy] = useState<'create' | 'import' | null>(null)
  const [error, setError] = useState('')
  const [capability, setCapability] = useState<Awaited<ReturnType<typeof inspectCodingToolchain>> | null>(null)

  useEffect(() => {
    void inspectCodingToolchain()
      .then(setCapability)
      .catch(() => undefined)
  }, [])

  const openWizard = () => {
    setWizardStep(0)
    setError('')
    setOpened(true)
  }
  const nextWizardStep = async () => {
    if (wizardStep === 2) {
      setWizardStep(3)
      try {
        setCapability(await inspectCodingToolchain())
        setWizardStep(4)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setWizardStep(2)
      }
      return
    }
    setWizardStep((step) => Math.min(5, step + 1))
  }

  const create = async () => {
    setBusy('create')
    setError('')
    try {
      const project = await createCodingProject({ name: name.trim(), targetId, packageName: packageName.trim() })
      setOpened(false)
      await navigate({ to: '/develop/$projectId', params: { projectId: project.id } })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const importProject = async () => {
    setBusy('import')
    setError('')
    try {
      const project = await importCodingProject()
      if (project) await navigate({ to: '/develop/$projectId', params: { projectId: project.id } })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="coding-home">
      <Stack gap="lg">
        <div className="coding-home-intro">
          <Title order={1} size="h2">
            {t('手机开发')}
          </Title>
          <Text c="dimmed" size="sm">
            {t('在本机创建、审查、运行并交付 Web 与 Android 项目。')}
          </Text>
        </div>
        {error && <Alert color="red">{error}</Alert>}
        <Box className="coding-capability-band">
          <Group className="coding-capability-header" justify="space-between">
            <Text fw={700}>{t('本地工具链')}</Text>
            <Button
              className="coding-refresh-control"
              aria-label={String(t('刷新本地工具链状态'))}
              size="compact-sm"
              variant="subtle"
              onClick={() => void inspectCodingToolchain().then(setCapability)}
            >
              <IconRefresh size={16} />
            </Button>
          </Group>
          <Group className="coding-capability-status" gap="xs" mt="xs">
            <Badge color={capability?.sandboxReady ? 'green' : 'gray'}>
              Linux {t(capability?.sandboxReady ? '就绪' : '未安装')}
            </Badge>
            <Badge color={capability?.androidToolchainReady ? 'green' : 'gray'}>
              Android SDK {t(capability?.androidToolchainReady ? '就绪' : '未安装')}
            </Badge>
            <Badge variant="light">{capability?.abi || t('检测中')}</Badge>
          </Group>
          {(!capability?.sandboxReady || !capability?.androidToolchainReady) && (
            <Button
              className="coding-environment-action"
              mt="sm"
              size="xs"
              variant="light"
              onClick={() => void navigate({ to: '/settings/developer-environment' })}
            >
              {t('配置开发环境')}
            </Button>
          )}
        </Box>
        <Group grow align="stretch" className="coding-home-actions">
          <Button
            className="coding-home-action coding-home-action-primary"
            h={52}
            leftSection={<IconCode size={20} />}
            onClick={openWizard}
          >
            {t('新建项目')}
          </Button>
          <Button
            className="coding-home-action coding-home-action-secondary"
            h={52}
            variant="light"
            leftSection={<IconFolderOpen size={20} />}
            loading={busy === 'import'}
            onClick={() => void importProject()}
          >
            {t('导入目录')}
          </Button>
        </Group>
        <section className="coding-recent-projects">
          <Text fw={700} mb="sm">
            {t('最近项目')}
          </Text>
          <Stack gap="sm">
            {projects.length === 0 && (
              <Box className="coding-empty-state">
                <IconFolderOpen aria-hidden="true" size={20} />
                <Text c="dimmed" size="sm">
                  {t('还没有开发项目。')}
                </Text>
              </Box>
            )}
            {projects.map((project) => (
              <button
                className="coding-project-row"
                key={project.id}
                onClick={() => void navigate({ to: '/develop/$projectId', params: { projectId: project.id } })}
              >
                {project.targetId.startsWith('android') ? <IconBrandAndroid size={24} /> : <IconBrowser size={24} />}
                <span>
                  <strong>{project.name}</strong>
                  <small>{getBuildTargetProfile(project.targetId).label}</small>
                </span>
                <Badge variant="light">{t(supportLabelKey(project.supportLevel))}</Badge>
              </button>
            ))}
          </Stack>
        </section>
      </Stack>
      <Modal
        className="coding-create-modal"
        opened={opened}
        onClose={() => setOpened(false)}
        title={t('新建开发项目')}
        centered
      >
        <Stack>
          <Stepper className="coding-create-steps" active={wizardStep} size="xs" allowNextStepsSelect={false}>
            <Stepper.Step label={t('目标')} />
            <Stepper.Step label={t('模板')} />
            <Stepper.Step label={t('项目')} />
            <Stepper.Step label={t('预检')} />
            <Stepper.Step label={t('空间')} />
            <Stepper.Step label={t('确认')} />
          </Stepper>
          {wizardStep === 0 && (
            <SegmentedControl
              value={targetId}
              onChange={(value) => setTargetId(value as BuildTargetId)}
              data={CREATE_TARGETS.map((id) => ({
                value: id,
                label: getBuildTargetProfile(id).label.replace(' Android APK', ''),
              }))}
              fullWidth
              orientation="vertical"
            />
          )}
          {wizardStep === 1 && (
            <Box>
              <Text fw={700}>{getBuildTargetProfile(targetId).label}</Text>
              <Text size="sm" c="dimmed">
                {t('固定模板 {{templateId}}，创建后立即执行最小构建。', {
                  templateId: getBuildTargetProfile(targetId).templateId,
                })}
              </Text>
            </Box>
          )}
          {wizardStep === 2 && (
            <Stack>
              <TextInput label={t('项目名称')} value={name} onChange={(event) => setName(event.currentTarget.value)} />
              {targetId.startsWith('android') && (
                <TextInput
                  label={t('Android 包名')}
                  value={packageName}
                  onChange={(event) => setPackageName(event.currentTarget.value)}
                  error={!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName) ? t('请输入有效包名') : undefined}
                />
              )}
            </Stack>
          )}
          {wizardStep === 3 && (
            <Group justify="center" py="xl">
              <Loader size="sm" />
              <Text size="sm">{t('正在检查 ABI、工具链与可用空间')}</Text>
            </Group>
          )}
          {wizardStep === 4 && (
            <Stack>
              <Group gap="xs">
                <Badge color={capability?.sandboxReady ? 'green' : 'red'}>
                  Linux {t(capability?.sandboxReady ? '就绪' : '未就绪')}
                </Badge>
                {targetId.startsWith('android') && (
                  <Badge color={capability?.androidToolchainReady ? 'green' : 'red'}>
                    Android SDK {t(capability?.androidToolchainReady ? '就绪' : '未就绪')}
                  </Badge>
                )}
              </Group>
              <Alert color={targetId === 'android-kotlin' ? 'yellow' : 'blue'}>
                {t('预计额外下载 {{download}}；最低可用空间 {{minimum}} GB，建议 {{recommended}} GB。', {
                  download: targetId.startsWith('android')
                    ? capability?.androidToolchainReady
                      ? '0 MB'
                      : t('约 2 GB')
                    : capability?.sandboxReady
                      ? '0 MB'
                      : t('约 250 MB'),
                  minimum: Math.round(getBuildTargetProfile(targetId).minimumFreeBytes / 1024 ** 3),
                  recommended: Math.round(getBuildTargetProfile(targetId).recommendedFreeBytes / 1024 ** 3),
                })}
              </Alert>
            </Stack>
          )}
          {wizardStep === 5 && (
            <Alert color="blue">
              {t(
                '将创建 {{target}} 项目“{{name}}”，写入应用私有工作区并启动首次构建。依赖下载和构建命令会单独请求确认。',
                { target: getBuildTargetProfile(targetId).label, name: name.trim() }
              )}
            </Alert>
          )}
          <Group justify="space-between">
            <Button
              variant="subtle"
              disabled={wizardStep === 0 || wizardStep === 3 || busy === 'create'}
              onClick={() => setWizardStep((step) => Math.max(0, step - 1))}
            >
              {t('上一步')}
            </Button>
            {wizardStep < 5 ? (
              <Button
                disabled={
                  (wizardStep === 2 &&
                    (!name.trim() ||
                      (targetId.startsWith('android') &&
                        !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)))) ||
                  wizardStep === 3
                }
                onClick={() => void nextWizardStep()}
              >
                {t('下一步')}
              </Button>
            ) : (
              <Button loading={busy === 'create'} onClick={() => void create()}>
                {t('确认创建')}
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </main>
  )
}

function ConversationView({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  const { data: session } = useTaskSessionRecord(taskId)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!input.trim() || sending) return
    setSending(true)
    const message = createMessage('user', input.trim())
    setInput('')
    try {
      await submitTaskMessage(taskId, message, { needGenerating: true })
    } finally {
      setSending(false)
    }
  }
  return (
    <Stack className="coding-pane" gap="sm">
      <ScrollArea flex={1}>
        <Stack gap="sm">
          {session?.messages.map((message) => (
            <Box key={message.id} className="coding-message" data-role={message.role}>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {getMessageText(message, true, true) || (message.generating ? t('正在工作...') : '')}
              </Text>
            </Box>
          ))}
        </Stack>
      </ScrollArea>
      <Group align="flex-end">
        <Textarea
          flex={1}
          autosize
          minRows={2}
          maxRows={5}
          placeholder={String(t('描述要实现或修改的内容'))}
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
        />
        <Button aria-label={String(t('发送'))} px="sm" loading={sending} onClick={() => void send()}>
          <IconSend size={19} />
        </Button>
      </Group>
    </Stack>
  )
}

function ProjectView({ project }: { project: CodingProjectRecord }) {
  const { t } = useTranslation()
  const [files, setFiles] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(false)
  const refresh = async () => {
    await platform.sandboxInit?.({ workingDirectory: project.workspaceKey })
    const result = await platform.sandboxFind?.({ dirPath: '.', pattern: '*' })
    setFiles(result?.success ? (result.content || '').split('\n').filter(Boolean).slice(0, 500) : [])
  }
  useEffect(() => {
    void refresh()
  }, [project.workspaceKey])
  const open = async (path: string) => {
    const result = await platform.sandboxRead?.({ filePath: path })
    setSelected(path)
    setContent(result?.content || '')
    setEditing(false)
  }
  const save = async () => {
    const result = await platform.sandboxWrite?.({ filePath: selected, content })
    if (!result?.success) throw new Error(result?.error)
    if (project.source.kind === 'saf') {
      await codingProjectStorage.put('projects', { ...project, dirtyExternalSync: true, updatedAt: Date.now() })
    }
    setEditing(false)
  }
  return (
    <div className="coding-project-pane">
      <aside>
        <Group justify="space-between" p="xs">
          <Text fw={700} size="sm">
            {t('项目文件')}
          </Text>
          <Button size="compact-xs" variant="subtle" onClick={() => void refresh()}>
            <IconRefresh size={15} />
          </Button>
        </Group>
        {files.map((path) => (
          <button key={path} onClick={() => void open(path)}>
            <IconFile size={14} />
            <span>{path}</span>
          </button>
        ))}
      </aside>
      <section>
        {selected ? (
          <Stack h="100%">
            <Group justify="space-between">
              <Text fw={700} size="sm">
                {selected}
              </Text>
              <Button size="compact-sm" variant="light" onClick={() => (editing ? void save() : setEditing(true))}>
                {t(editing ? '保存' : '编辑')}
              </Button>
            </Group>
            <Textarea
              value={content}
              readOnly={!editing}
              onChange={(event) => setContent(event.currentTarget.value)}
              className="coding-editor"
              autosize
              minRows={18}
            />
          </Stack>
        ) : (
          <Text c="dimmed">{t('选择一个文件查看内容。')}</Text>
        )}
      </section>
    </div>
  )
}

function operationDiff(operation: CodingChangeOperation) {
  const before = operation.kind === 'create' ? [] : (operation.baseContent || '').split('\n')
  const after = operation.kind === 'delete' ? [] : operation.content.split('\n')
  const oldPath = operation.kind === 'create' ? '/dev/null' : `a/${operation.path}`
  const newPath = operation.kind === 'delete' ? '/dev/null' : `b/${operation.path}`
  return [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@`,
    ...before.map((line) => `-${line}`),
    ...after.map((line) => `+${line}`),
  ].join('\n')
}

function ChangesView({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { data: project } = useCodingProject(projectId)
  const { data: changes = [], refetch } = useCodingChangeSets(projectId)
  const [busy, setBusy] = useState('')
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key)
    try {
      await action()
      await refetch()
    } finally {
      setBusy('')
    }
  }
  return (
    <Stack className="coding-pane">
      <Group justify="space-between">
        <Text fw={700}>{t('变更集')}</Text>
        <Button size="compact-sm" variant="subtle" onClick={() => void refetch()}>
          <IconRefresh size={16} />
        </Button>
      </Group>
      {changes.length === 0 && (
        <Text c="dimmed" size="sm">
          {t('Agent 提出的文件修改会在这里等待审查。')}
        </Text>
      )}
      {[...changes]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((change) => (
          <Box key={change.id} className="coding-change">
            <Group justify="space-between">
              <div>
                <Text fw={700} size="sm">
                  {change.objective}
                </Text>
                <Badge size="xs" variant="light">
                  {t(change.state)}
                </Badge>
              </div>
              {change.state === 'pending' && project && (
                <Group gap="xs">
                  <Button
                    size="compact-sm"
                    color="red"
                    variant="light"
                    onClick={() => void run(change.id, () => rejectCodingChangeSet(change))}
                  >
                    <IconX size={14} />
                    {t('拒绝全部')}
                  </Button>
                  <Button
                    size="compact-sm"
                    loading={busy === change.id}
                    onClick={() => void run(change.id, () => applyCodingChangeSet(project, change))}
                  >
                    <IconCheck size={14} />
                    {t('应用全部')}
                  </Button>
                </Group>
              )}
            </Group>
            {change.operations.map((operation) => (
              <Box key={operation.path} mt="sm">
                <Group justify="space-between" gap="xs">
                  <Text size="xs" fw={700}>
                    {operation.kind} · {operation.path}
                  </Text>
                  {change.state === 'pending' && project && (
                    <Group gap={4}>
                      <Button
                        size="compact-xs"
                        color="red"
                        variant="subtle"
                        onClick={() =>
                          void run(`${change.id}:${operation.path}`, () =>
                            rejectCodingChangeFiles(change, [operation.path])
                          )
                        }
                      >
                        {t('拒绝')}
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="light"
                        loading={busy === `${change.id}:${operation.path}`}
                        onClick={() =>
                          void run(`${change.id}:${operation.path}`, () =>
                            applyCodingChangeSet(project, change, project.taskId, [operation.path])
                          )
                        }
                      >
                        {t('应用')}
                      </Button>
                    </Group>
                  )}
                </Group>
                <Code block className="coding-diff">
                  {operationDiff(operation)}
                </Code>
              </Box>
            ))}
          </Box>
        ))}
    </Stack>
  )
}

function RunView({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { data: project } = useCodingProject(projectId)
  const { data: builds = [], refetch } = useCodingBuildRuns(projectId)
  const { data: artifacts = [], refetch: refetchArtifacts } = useCodingArtifacts(projectId)
  const [log, setLog] = useState('')
  const [inspection, setInspection] = useState<(NativeApkInspection & { workspacePath: string }) | null>(null)
  const [busy, setBusy] = useState('')
  const profile = project ? getBuildTargetProfile(project.targetId) : null
  useEffect(() => {
    if (!inspection || !platform.workspacePackageStatus) return
    return platform.onWindowFocused(() => {
      void (async () => {
        const status = await platform.workspacePackageStatus?.(inspection.packageName)
        if (!status?.installed || status.versionCode !== inspection.versionCode) return
        const artifact = artifacts.find((candidate) => candidate.sha256 === inspection.sha256)
        if (artifact) await codingProjectStorage.put('artifacts', { ...artifact, state: 'verified' })
        await refetchArtifacts()
      })()
    })
  }, [artifacts, inspection, refetchArtifacts])
  const start = async (kind: 'install' | 'build' | 'test' | 'preview') => {
    if (!project || !profile) return
    const command =
      kind === 'install'
        ? profile.installCommand
        : kind === 'test'
          ? profile.testCommand
          : kind === 'preview'
            ? profile.category === 'web'
              ? profile.id === 'web-static'
                ? 'python3 -m http.server 5173 --bind 127.0.0.1'
                : 'npm run dev -- --host 127.0.0.1'
              : ''
            : profile.buildCommand
    if (!command) return
    setBusy(kind)
    try {
      await startCodingBuildRun(project, kind, command, kind === 'build' ? 900_000 : 600_000)
      await refetch()
      if (kind === 'preview' && platform.registerWorkspacePreview && platform.openWorkspacePreview) {
        const preview = await platform.registerWorkspacePreview({ port: 5173, path: '/' })
        if (preview.success && preview.id) await platform.openWorkspacePreview(preview.id)
      }
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy('')
    }
  }
  const readLog = async (run: CodingBuildRun) => {
    if (!run.nativeJobId) return
    const out = await platform.sandboxReadJobOutput?.({ jobId: run.nativeJobId, stdoutOffset: 0, stderrOffset: 0 })
    setLog(`${out?.stdout || ''}${out?.stderr || ''}`)
  }
  const scanApk = async () => {
    if (!project || !platform.inspectWorkspaceApk) return
    const found = await platform.sandboxFind?.({ dirPath: '.', pattern: '*.apk' })
    const path = (found?.content || '')
      .split('\n')
      .map((candidate) => candidate.trim())
      .filter((candidate) => artifactPathMatches(candidate, project.buildConfig.artifactPatterns))
      .at(-1)
    if (!path) {
      setLog(String(t('未找到 APK。请先完成 Debug 构建。')))
      return
    }
    const inspected = await platform.inspectWorkspaceApk({ workspaceKey: project.workspaceKey, path })
    setInspection({ ...inspected, workspacePath: path })
    await codingProjectStorage.put('artifacts', {
      schemaVersion: 1,
      id: uuidv4(),
      projectId,
      buildRunId: builds[0]?.id || 'manual',
      type: 'apk',
      path,
      size: inspected.size,
      sha256: inspected.sha256,
      state: 'inspected',
      packageName: inspected.packageName,
      versionName: inspected.versionName,
      signerSha256: inspected.signerSha256,
      permissions: inspected.permissions,
      createdAt: Date.now(),
    })
  }
  const installApk = async () => {
    if (!project || !inspection || inspection.hostPackageBlocked || !inspection.signatureMatchesInstalled) return
    const permission = await platform.workspaceInstallPermission?.()
    if (permission && !permission.allowed) {
      await platform.openWorkspaceInstallPermission?.()
      return
    }
    await platform.installWorkspaceApk?.({
      workspaceKey: project.workspaceKey,
      path: inspection.workspacePath,
      expectedSha256: inspection.sha256,
    })
  }
  const stop = async (run: CodingBuildRun) => {
    if (run.nativeJobId) {
      await platform.sandboxStopJob?.({ jobId: run.nativeJobId })
      await refetch()
    }
  }
  return (
    <Stack className="coding-pane">
      <Group>
        <Button
          leftSection={<IconPlayerPlay size={17} />}
          loading={busy === 'build'}
          disabled={!profile || profile.verification !== 'local-build-and-verify'}
          onClick={() => void start('build')}
        >
          {t('构建')}
        </Button>
        {profile?.testCommand && (
          <Button variant="light" loading={busy === 'test'} onClick={() => void start('test')}>
            {t('测试')}
          </Button>
        )}
        {profile?.category === 'web' && (
          <Button
            variant="light"
            leftSection={<IconBrowser size={17} />}
            loading={busy === 'preview'}
            onClick={() => void start('preview')}
          >
            {t('预览')}
          </Button>
        )}
        {profile?.installCommand && (
          <Button variant="light" loading={busy === 'install'} onClick={() => void start('install')}>
            {t('安装依赖')}
          </Button>
        )}
      </Group>
      {profile?.verification === 'remote-build-required' && (
        <Alert>{t('此目标需要远程构建。首版尚未配置 RemoteBuildProvider，只能准备源码。')}</Alert>
      )}
      {profile?.verification === 'local-source-only' && (
        <Alert>{t('此目标在手机端仅支持源码编辑，不会标记为本机构建或验证成功。')}</Alert>
      )}
      <Text fw={700}>{t('运行记录')}</Text>
      {[...builds]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((run) => (
          <Group key={run.id} wrap="nowrap">
            <button className="coding-run-row" onClick={() => void readLog(run)}>
              <IconTerminal2 size={18} />
              <span>
                {t(run.kind)}
                <small>{t(run.state)}</small>
              </span>
            </button>
            {(run.state === 'queued' || run.state === 'running') && (
              <Button size="compact-xs" color="red" variant="subtle" onClick={() => void stop(run)}>
                {t('停止')}
              </Button>
            )}
          </Group>
        ))}
      {log && (
        <Code block className="coding-log">
          {log}
        </Code>
      )}
      <Group justify="space-between">
        <Text fw={700}>{t('产物')}</Text>
        {profile?.delivery === 'install-apk' && (
          <Button size="compact-sm" variant="light" onClick={() => void scanApk()}>
            {t('检查 APK')}
          </Button>
        )}
      </Group>
      {artifacts.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('构建完成后，可检查、分享或安装的产物会显示在这里。')}
        </Text>
      ) : (
        artifacts.map((artifact) => (
          <Box key={artifact.id}>
            <IconArchive size={16} />
            {artifact.path} · {t(artifact.state)}
          </Box>
        ))
      )}
      {inspection && (
        <Box className="coding-change">
          <Text fw={700}>
            {inspection.packageName} · {inspection.versionName || inspection.versionCode}
          </Text>
          <Text size="xs">SHA-256: {inspection.sha256}</Text>
          <Text size="xs">
            {t('签名')}: {inspection.signerSha256}
          </Text>
          <Text size="xs">
            {t('权限')} ({inspection.permissions.length}): {inspection.permissions.join(', ') || t('无')}
          </Text>
          {inspection.hostPackageBlocked && (
            <Alert color="red" mt="xs">
              {t('禁止安装与 Yachiyo Claw 相同包名的 APK。')}
            </Alert>
          )}
          {!inspection.signatureMatchesInstalled && (
            <Alert color="red" mt="xs">
              {t('签名与已安装应用不匹配，不能覆盖安装。')}
            </Alert>
          )}
          <Group mt="sm">
            <Button
              disabled={inspection.hostPackageBlocked || !inspection.signatureMatchesInstalled}
              onClick={() => void installApk()}
            >
              {t('确认并打开系统安装器')}
            </Button>
            {inspection.installed && (
              <Button variant="light" onClick={() => void platform.launchWorkspacePackage?.(inspection.packageName)}>
                {t('启动应用')}
              </Button>
            )}
          </Group>
        </Box>
      )}
    </Stack>
  )
}

export function CodingProjectWorkspace() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { projectId } = useParams({ from: '/develop/$projectId' })
  const { data: project, isLoading, refetch } = useCodingProject(projectId)
  const [tab, setTab] = useState<string | null>('conversation')
  useEffect(() => {
    if (project) void platform.sandboxInit?.({ workingDirectory: project.workspaceKey })
  }, [project])
  if (isLoading) return <Loader m="xl" />
  if (!project)
    return (
      <Alert color="red" m="md">
        {t('开发项目不存在或记录已损坏。')}
      </Alert>
    )
  const syncOut = async () => {
    const result = await platform.syncExternalWorkspace?.('out')
    if (!result?.success) return
    await codingProjectStorage.put('projects', { ...project, dirtyExternalSync: false, updatedAt: Date.now() })
    await refetch()
  }
  const useProject = async () => {
    setAgentWorkingDirectory(project.workspaceKey)
    saveAgentSessionConfig(project.taskId, {
      enabled: true,
      configured: true,
      deviceControlEnabled: false,
      workingDirectory: project.workspaceKey,
    })
    await platform.sandboxInit?.({ workingDirectory: project.workspaceKey })
    taskSessionStore.getState().setCurrentTaskId(project.taskId)
    await navigate({ to: '/task/$taskId', params: { taskId: project.taskId } })
  }
  return (
    <main className="coding-workspace">
      <Group justify="space-between" className="coding-project-header">
        <div>
          <Text fw={800}>{project.name}</Text>
          <Text size="xs" c="dimmed">
            {getBuildTargetProfile(project.targetId).label}
          </Text>
        </div>
        <Group gap="xs" wrap="wrap" justify="flex-end">
          <Badge>{t(supportLabelKey(project.supportLevel))}</Badge>
          <Button size="compact-sm" leftSection={<IconRobot size={16} />} onClick={() => void useProject()}>
            {t('使用此项目')}
          </Button>
        </Group>
      </Group>
      {project.source.kind === 'saf' && project.dirtyExternalSync && (
        <Alert color="yellow" m="sm">
          {t('项目修改尚未写回外部目录。')}
          <Button ml="sm" size="compact-xs" variant="light" onClick={() => void syncOut()}>
            {t('写回目录')}
          </Button>
        </Alert>
      )}
      <Tabs value={tab} onChange={setTab} className="coding-tabs">
        <Tabs.List grow>
          <Tabs.Tab value="conversation" leftSection={<IconSend size={16} />}>
            {t('对话')}
          </Tabs.Tab>
          <Tabs.Tab value="project" leftSection={<IconFile size={16} />}>
            {t('项目')}
          </Tabs.Tab>
          <Tabs.Tab value="changes" leftSection={<IconGitBranch size={16} />}>
            {t('改动')}
          </Tabs.Tab>
          <Tabs.Tab value="run" leftSection={<IconTerminal2 size={16} />}>
            {t('运行')}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="conversation">
          <ConversationView taskId={project.taskId} />
        </Tabs.Panel>
        <Tabs.Panel value="project">
          <ProjectView project={project} />
        </Tabs.Panel>
        <Tabs.Panel value="changes">
          <ChangesView projectId={project.id} />
        </Tabs.Panel>
        <Tabs.Panel value="run">
          <RunView projectId={project.id} />
        </Tabs.Panel>
      </Tabs>
    </main>
  )
}
