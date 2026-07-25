import { Alert, Badge, Box, Button, Code, Divider, Flex, Group, Modal, Progress, Stack, Text, Textarea, Title } from '@mantine/core'
import { IconDownload, IconPlayerPlay, IconPlayerStop, IconRefresh, IconTerminal2, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import Page from '@/components/layout/Page'
import {
  type NativeSandboxProgress,
  type NativeSandboxJob,
  type NativeSandboxStatus,
  yachiyoSandboxNative,
} from '@/platform/native/yachiyo_sandbox'

export const Route = createFileRoute('/settings/developer-environment')({
  component: DeveloperEnvironmentPage,
})

function DeveloperEnvironmentPage() {
  const [status, setStatus] = useState<NativeSandboxStatus | null>(null)
  const [progress, setProgress] = useState<NativeSandboxProgress | null>(null)
  const [busy, setBusy] = useState<'install' | 'android-toolchain' | 'run' | 'reset' | null>(null)
  const [command, setCommand] = useState('python3 --version && node --version && git --version')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [jobs, setJobs] = useState<NativeSandboxJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobOutput, setJobOutput] = useState<Record<string, string>>({})
  const outputOffsets = useRef<Record<string, { stdout: number; stderr: number }>>({})

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, queue] = await Promise.all([
        yachiyoSandboxNative.status(),
        yachiyoSandboxNative.listJobs().catch(() => ({ jobs: [] as NativeSandboxJob[] })),
      ])
      setStatus(nextStatus)
      setJobs(queue.jobs)
      for (const job of queue.jobs) {
        const offsets = outputOffsets.current[job.id] || { stdout: 0, stderr: 0 }
        const chunk = await yachiyoSandboxNative
          .readJobOutput({ jobId: job.id, stdoutOffset: offsets.stdout, stderrOffset: offsets.stderr })
          .catch(() => null)
        if (!chunk) continue
        outputOffsets.current[job.id] = { stdout: chunk.stdoutOffset, stderr: chunk.stderrOffset }
        if (chunk.stdout || chunk.stderr) {
          setJobOutput((current) => ({ ...current, [job.id]: `${current[job.id] || ''}${chunk.stdout}${chunk.stderr}` }))
        }
      }
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError))
    }
  }, [])

  useEffect(() => {
    void refresh()
    let handle: { remove: () => Promise<void> } | undefined
    void yachiyoSandboxNative.addListener('progress', setProgress).then((value) => {
      handle = value
    })
    return () => {
      void handle?.remove()
    }
  }, [refresh])

  useEffect(() => {
    if (!jobs.some((job) => job.state === 'queued' || job.state === 'running')) return
    const timer = window.setInterval(() => void refresh(), 1_500)
    return () => window.clearInterval(timer)
  }, [jobs, refresh])

  const install = async () => {
    setBusy('install')
    setError(null)
    try {
      await yachiyoSandboxNative.install()
      await yachiyoSandboxNative.init({ workingDirectory: 'default' })
      await refresh()
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError))
    } finally {
      setBusy(null)
    }
  }

  const run = async () => {
    setBusy('run')
    setError(null)
    try {
      await yachiyoSandboxNative.init({ workingDirectory: 'default' })
      const result = await yachiyoSandboxNative.exec({ command, timeout: 120_000 })
      setOutput(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}\n[exit ${result.exitCode}]`.trim())
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setBusy(null)
    }
  }

  const installAndroidToolchain = async () => {
    setBusy('android-toolchain')
    setError(null)
    try {
      await yachiyoSandboxNative.init({ workingDirectory: 'default' })
      const result = await yachiyoSandboxNative.installAndroidToolchain()
      if (!result.accepted) throw new Error(result.reason || 'android_toolchain_install_unavailable')
      setSelectedJobId(result.jobId || null)
      await refresh()
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError))
    } finally {
      setBusy(null)
    }
  }

  const stopJob = async (jobId: string) => {
    setError(null)
    try {
      await yachiyoSandboxNative.stopJob({ jobId })
      await refresh()
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : String(stopError))
    }
  }

  const reset = async () => {
    setBusy('reset')
    setResetOpen(false)
    setError(null)
    try {
      const result = await yachiyoSandboxNative.reset()
      if (!result.success) throw new Error(result.error || 'sandbox_reset_failed')
      setOutput('')
      setProgress(null)
      await refresh()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError))
    } finally {
      setBusy(null)
    }
  }

  const stageNames: Record<string, string> = {
    downloading: '下载 Alpine Linux',
    extracting: '安装 Linux 文件系统',
    rootfs_ready: 'Linux 基础环境已就绪',
    installing_toolchain: '安装 Python、Node.js 和 Git',
    ready: '开发环境已就绪',
  }

  return (
    <Page title="本地开发环境">
      <Box p="md" maw={760} mx="auto" w="100%">
        <Stack gap="lg">
          <Flex align="center" justify="space-between" gap="md" wrap="wrap">
            <Group gap="sm">
              <IconTerminal2 size={28} />
              <div>
                <Title order={2} size="h3">Linux 沙箱</Title>
                <Text size="sm" c="dimmed">Alpine Linux · PRoot · 应用私有工作区</Text>
              </div>
            </Group>
            <Group gap="xs">
              <Badge color={status?.toolchainReady ? 'green' : 'gray'} variant="light" radius="xl">
                {status?.toolchainReady ? '可用' : '未安装'}
              </Badge>
              <Button variant="subtle" color="gray" px="xs" aria-label="刷新状态" onClick={() => void refresh()}>
                <IconRefresh size={18} />
              </Button>
            </Group>
          </Flex>

          {progress && busy === 'install' && (
            <Stack gap={6}>
              <Flex justify="space-between">
                <Text size="sm" fw={600}>{stageNames[progress.stage] || progress.stage}</Text>
                {progress.total > 0 && <Text size="xs" c="dimmed">{progress.percent}%</Text>}
              </Flex>
              <Progress value={progress.total > 0 ? progress.percent : 100} animated={progress.total <= 0} color="pink" radius="xl" />
            </Stack>
          )}

          {error && <Alert color="red" radius="md">{error}</Alert>}

          {!status?.toolchainReady && (
            <Button color="pink" radius="xl" loading={busy === 'install'} onClick={() => void install()}>
              安装开发环境
            </Button>
          )}

          {status?.toolchainReady && (
            <Flex justify="space-between" align="center" gap="md" wrap="wrap">
              <div>
                <Group gap="xs">
                  <Text fw={700}>Android SDK / Gradle</Text>
                  <Badge color={status.androidToolchainReady ? 'green' : 'gray'} variant="light" radius="xl">
                    {status.androidToolchainReady ? '已就绪' : '未安装'}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {status.androidToolchainVariant === 'arm64-patched-aapt2'
                    ? 'ARM64 工具链，使用校验后的原生 AAPT2'
                    : status.androidToolchainVariant === 'x86_64-official'
                      ? 'Google 官方 x86_64 Android SDK 工具链'
                      : '当前 CPU 架构不支持完整 Android 构建工具链'}
                </Text>
              </div>
              {!status.androidToolchainReady && (
                <Button
                  size="xs"
                  radius="xl"
                  variant="light"
                  color="pink"
                  leftSection={<IconDownload size={16} />}
                  loading={busy === 'android-toolchain'}
                  disabled={!status.androidToolchainSupported || busy !== null}
                  onClick={() => void installAndroidToolchain()}
                >
                  安装工具链
                </Button>
              )}
            </Flex>
          )}

          <Divider />

          <Stack gap="sm">
            <Text fw={700}>终端自检</Text>
            <Textarea
              value={command}
              onChange={(event) => setCommand(event.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={6}
              radius="md"
              disabled={!status?.toolchainReady || busy !== null}
            />
            <Button
              leftSection={<IconPlayerPlay size={18} />}
              radius="xl"
              variant="light"
              color="pink"
              loading={busy === 'run'}
              disabled={!status?.toolchainReady || busy !== null}
              onClick={() => void run()}
            >
              运行
            </Button>
            {output && <Code block mah={280} style={{ overflow: 'auto', whiteSpace: 'pre-wrap' }}>{output}</Code>}
          </Stack>

          <Divider />

          <Stack gap="xs">
            <Flex justify="space-between" align="center">
              <Text fw={700}>后台任务</Text>
              <Badge variant="light" color="gray" radius="xl">{jobs.length}</Badge>
            </Flex>
            {jobs.length === 0 && <Text size="sm" c="dimmed">暂无后台构建或开发服务。</Text>}
            {jobs.slice(0, 12).map((job) => {
              const active = job.state === 'queued' || job.state === 'running'
              return (
                <Box key={job.id} p="sm" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 8 }}>
                  <Flex justify="space-between" align="center" gap="sm">
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>{job.id}</Text>
                      <Text size="xs" c="dimmed">{job.state}{job.exitCode == null ? '' : ` · exit ${job.exitCode}`}</Text>
                    </div>
                    <Group gap={4} wrap="nowrap">
                      <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setSelectedJobId(job.id)}>
                        日志
                      </Button>
                      {active && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          aria-label="停止后台任务"
                          onClick={() => void stopJob(job.id)}
                        >
                          <IconPlayerStop size={15} />
                        </Button>
                      )}
                    </Group>
                  </Flex>
                </Box>
              )
            })}
            {selectedJobId && (
              <Code block mah={220} style={{ overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {jobOutput[selectedJobId] || '等待任务输出...'}
              </Code>
            )}
          </Stack>

          <Divider />

          <Flex justify="space-between" align="center" gap="md" wrap="wrap">
            <div>
              <Text fw={700}>修复环境</Text>
              <Text size="sm" c="dimmed">删除 Linux 系统后可重新安装，工作区项目会保留。</Text>
            </div>
            <Button
              color="red"
              variant="light"
              radius="xl"
              leftSection={<IconTrash size={18} />}
              loading={busy === 'reset'}
              onClick={() => setResetOpen(true)}
            >
              重置
            </Button>
          </Flex>
        </Stack>
      </Box>

      <Modal opened={resetOpen} onClose={() => setResetOpen(false)} title="重置 Linux 环境" centered radius="lg">
        <Stack>
          <Text size="sm">Linux 系统和已安装的软件包会被删除，项目工作区不会被删除。</Text>
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={() => setResetOpen(false)}>取消</Button>
            <Button color="red" onClick={() => void reset()}>确认重置</Button>
          </Group>
        </Stack>
      </Modal>
    </Page>
  )
}
