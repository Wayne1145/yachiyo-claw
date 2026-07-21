import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Flex,
  Loader,
  Paper,
  SimpleGrid,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import type { MarketplaceSkill, SkillInfo } from '@shared/types/skills'
import {
  IconBrandGithub,
  IconDots,
  IconDownload,
  IconFolderOpen,
  IconPlus,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconWand,
  IconWorld,
} from '@tabler/icons-react'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import ActionMenu, { type ActionMenuItemProps } from '@/components/ActionMenu'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useSkillTranslation } from '@/hooks/useSkillTranslation'
import { skillsController } from '@/packages/skills/controller'
import { toastError } from '@/packages/toast'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import GitHubInstallModal, { type DetectedSkill } from './GitHubInstallModal'
import SkillsSpotlight, { skillsSpotlight } from './SkillsSpotlight'
import { SKILLS_POPULAR, type SkillRegistryEntry } from './registries'

function registrySkill(entry: SkillRegistryEntry): MarketplaceSkill {
  return {
    id: `${entry.source}/${entry.skillId || entry.name}`,
    skillId: entry.skillId || entry.name,
    name: entry.title,
    installs: entry.installs || 0,
    source: entry.source,
    description: entry.description,
  }
}

const SkillCard: FC<{
  skill: SkillInfo
  translatedName?: string
  enabled: boolean
  onToggle: (name: string, enabled: boolean) => void
  actionItems?: ActionMenuItemProps[]
}> = ({ skill, translatedName, enabled, onToggle, actionItems }) => {
  const [menuOpened, setMenuOpened] = useState(false)

  return (
    <Paper
      shadow="xs"
      radius="md"
      withBorder
      p="sm"
      className="transition-all duration-150 hover:shadow-md"
      style={{ opacity: enabled ? 1 : 0.72 }}
    >
      <Flex justify="space-between" align="flex-start" gap={8}>
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={600} lineClamp={1}>
            {skill.name}
          </Text>
          {translatedName && (
            <Text size="xs" c="chatbox-tertiary" lineClamp={1} mt={2}>
              {translatedName}
            </Text>
          )}
        </Box>

        <Flex align="center" gap={4} style={{ flexShrink: 0 }}>
          {actionItems && actionItems.length > 0 && (
            <ActionMenu
              type="desktop"
              items={actionItems}
              position="bottom-start"
              opened={menuOpened}
              onChange={(opened) => setMenuOpened(opened)}
            >
              <ActionIcon
                variant="transparent"
                size="sm"
                color="chatbox-tertiary"
                onClick={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                }}
              >
                <ScalableIcon icon={IconDots} size={14} />
              </ActionIcon>
            </ActionMenu>
          )}
          <Switch size="xs" checked={enabled} onChange={(e) => onToggle(skill.name, e.currentTarget.checked)} />
        </Flex>
      </Flex>

      <Tooltip
        label={skill.description}
        multiline
        withArrow
        w={420}
        openDelay={400}
        events={{ hover: true, focus: true, touch: true }}
      >
        <Text size="xs" mt={8} c="chatbox-tertiary" lineClamp={2} className="cursor-help leading-relaxed">
          {skill.description}
        </Text>
      </Tooltip>

      {(skill.bodyTokenEstimate != null || skill.source?.repo) && (
        <Flex mt={8} gap={6} wrap="wrap">
          {skill.bodyTokenEstimate != null && (
            <Badge size="xs" variant="light" color="chatbox-brand" radius="sm">
              ~{skill.bodyTokenEstimate.toLocaleString()} tokens
            </Badge>
          )}
          {skill.source?.repo && (
            <Badge size="xs" variant="light" color="gray" radius="sm">
              {skill.source.repo}
            </Badge>
          )}
        </Flex>
      )}
    </Paper>
  )
}

const SectionHeader: FC<{
  title: string
  count?: number
  right?: React.ReactNode
  className?: string
}> = ({ title, count, right, className }) => (
  <Flex justify="space-between" align="center" className={className}>
    <Flex align="center" gap={8}>
      <Text size="sm" fw={600}>
        {title}
      </Text>
      {count != null && (
        <Badge size="xs" variant="light" color="gray" radius="sm">
          {count}
        </Badge>
      )}
    </Flex>
    {right && (
      <Flex align="center" gap="xs">
        {right}
      </Flex>
    )}
  </Flex>
)

const EmptyState: FC<{ onAddClick: () => void; onOpenFolder: () => void }> = ({ onAddClick, onOpenFolder }) => {
  const { t } = useTranslation()

  return (
    <Paper radius="md" p="xl" className="border border-dashed border-chatbox-border-primary">
      <Flex direction="column" align="center" gap={12} py="md">
        <Box className="rounded-full p-3 bg-chatbox-background-gray-secondary">
          <ScalableIcon icon={IconWand} size={24} className="text-chatbox-tint-tertiary" />
        </Box>
        <Box className="text-center">
          <Text size="sm" fw={500}>
            {t('No custom skills yet')}
          </Text>
          <Text size="xs" c="chatbox-tertiary" mt={4}>
            {t('Add skills from the marketplace or install from a GitHub repository.')}
          </Text>
        </Box>
        <Flex gap="xs" mt={4}>
          <Button
            variant="light"
            size="xs"
            leftSection={<ScalableIcon icon={IconSearch} size={14} />}
            onClick={onAddClick}
          >
            {t('Browse Skills')}
          </Button>
          <Button
            variant="subtle"
            size="xs"
            leftSection={<ScalableIcon icon={IconFolderOpen} size={14} />}
            onClick={onOpenFolder}
          >
            {t('Open Skills Folder')}
          </Button>
        </Flex>
      </Flex>
    </Paper>
  )
}

export const SkillsSection: FC = () => {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const [scanning, setScanning] = useState(false)
  const [detectedSkills, setDetectedSkills] = useState<DetectedSkill[]>([])
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [repoInfo, setRepoInfo] = useState({ owner: '', repo: '' })
  const [showGithubInput, setShowGithubInput] = useState(false)
  const [marketplaceQuery, setMarketplaceQuery] = useState('')
  const [marketplaceResults, setMarketplaceResults] = useState<MarketplaceSkill[] | null>(null)
  const [marketplaceLoading, setMarketplaceLoading] = useState(false)
  const [installingMarketplaceSkill, setInstallingMarketplaceSkill] = useState<string | null>(null)
  const skillSettings = useSettingsStore((state) => state.skills)
  const { translatedSkills, getTranslatedName, isTranslating, translationEnabled, toggleTranslation } =
    useSkillTranslation(skills)

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    try {
      const discovered = await skillsController.discoverSkills()
      setSkills(discovered)
    } catch (err) {
      console.error('Failed to discover skills:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const originalUserSkillByPath = useMemo(() => {
    return new Map(skills.filter((skill) => !skill.isBuiltin).map((skill) => [skill.path, skill]))
  }, [skills])

  const userSkills = translatedSkills.filter((skill) => !skill.isBuiltin)

  const getOriginalUserSkill = useCallback(
    (skill: SkillInfo) => {
      return originalUserSkillByPath.get(skill.path) ?? skill
    },
    [originalUserSkillByPath]
  )

  const handleUserToggle = useCallback((name: string, enabled: boolean) => {
    settingsStore.setState((state) => {
      const current = state.skills.enabledSkillNames
      if (enabled) {
        if (current.includes(name)) return state
        return { skills: { ...state.skills, enabledSkillNames: [...current, name] } }
      }
      return { skills: { ...state.skills, enabledSkillNames: current.filter((n) => n !== name) } }
    })
  }, [])

  const handleOpenFolder = useCallback(async () => {
    try {
      await skillsController.openSkillsDirectory()
    } catch (err) {
      console.error('Failed to open skills directory:', err)
    }
  }, [])

  const parseGitHubRepo = useCallback((url: string): { owner: string; repo: string } | null => {
    const trimmed = url.trim()
    const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/i)
    if (!match) return null
    return { owner: match[1], repo: match[2] }
  }, [])

  const handleScanRepo = useCallback(async () => {
    const parsed = parseGitHubRepo(githubUrl)
    if (!parsed) {
      toastError(t('Please enter a valid GitHub repository URL'))
      return
    }

    setScanning(true)
    try {
      const discovered = await skillsController.scanRepo(parsed.owner, parsed.repo)
      setDetectedSkills(discovered)
      setRepoInfo(parsed)

      if (!discovered.length) {
        toastError(t('No skills found in this repository'))
        return
      }

      setInstallModalOpen(true)
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('Failed to scan repository'))
    } finally {
      setScanning(false)
    }
  }, [githubUrl, parseGitHubRepo, t])

  const searchMarketplace = useCallback(async () => {
    const query = marketplaceQuery.trim()
    if (!query) {
      setMarketplaceResults(null)
      return
    }
    setMarketplaceLoading(true)
    try {
      const response = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=24`)
      if (!response.ok) throw new Error(`SkillHub HTTP ${response.status}`)
      const data = (await response.json()) as { skills?: MarketplaceSkill[] }
      setMarketplaceResults(data.skills || [])
    } catch (error) {
      toastError(error instanceof Error ? error.message : 'SkillHub 搜索失败')
    } finally {
      setMarketplaceLoading(false)
    }
  }, [marketplaceQuery])

  const marketplaceSkills = marketplaceResults ?? SKILLS_POPULAR.slice(0, 8).map(registrySkill)

  const installMarketplaceSkill = useCallback(
    async (skill: MarketplaceSkill) => {
      const key = skill.id || skill.skillId
      setInstallingMarketplaceSkill(key)
      try {
        const result = await skillsController.installMarketplaceSkill(skill)
        if (!result.success) {
          toastError(result.error || 'Skill 安装失败')
          return
        }
        settingsStore.setState((state) => ({
          skills: {
            ...state.skills,
            enabledSkillNames: state.skills.enabledSkillNames.includes(result.skillName)
              ? state.skills.enabledSkillNames
              : [...state.skills.enabledSkillNames, result.skillName],
          },
        }))
        toast.success(`已安装 ${result.skillName}`)
        await fetchSkills()
      } finally {
        setInstallingMarketplaceSkill(null)
      }
    },
    [fetchSkills]
  )

  const handleDeleteSkill = useCallback(
    async (name: string) => {
      try {
        const result = await skillsController.deleteSkill(name)
        if (!result.success) {
          toastError(result.error ?? t('Failed to delete skill'))
          return
        }

        settingsStore.setState((state) => ({
          skills: {
            ...state.skills,
            enabledSkillNames: state.skills.enabledSkillNames.filter((skillName) => skillName !== name),
          },
        }))

        toast.success(t('Skill deleted'))
        await fetchSkills()
      } catch (error) {
        toastError(error instanceof Error ? error.message : t('Failed to delete skill'))
      }
    },
    [fetchSkills, t]
  )

  const handleCheckUpdate = useCallback(
    async (name: string) => {
      try {
        const result = await skillsController.checkForUpdate(name)
        if (result.error) {
          toastError(result.error)
          return
        }

        if (result.hasUpdate) {
          toast.success(t('Update available for {{name}}', { name }))
          return
        }

        toast.info(t('No updates for {{name}}', { name }))
      } catch (error) {
        toastError(error instanceof Error ? error.message : t('Failed to check for updates'))
      }
    },
    [t]
  )

  const handleScriptExecution = useCallback(
    async (skill: SkillInfo, enabled: boolean) => {
      const capabilities = Array.from(
        new Set(skill.source?.capabilityManifest?.scriptEntrypoints?.flatMap((entrypoint) => entrypoint.capabilities) || [])
      )
      const apply = async () => {
        const result = await skillsController.configureScriptExecution(skill.name, enabled, capabilities)
        if (!result.success) {
          toastError(result.error || t('Failed to update Skill script permission'))
          return
        }
        toast.success(enabled ? t('Skill script execution enabled') : t('Skill script execution disabled'))
        await fetchSkills()
      }
      if (!enabled) return apply()
      const confirmUnrestrictedExecution = () =>
        modals.openConfirmModal({
          title: t('Enable unrestricted privileged script execution?'),
          children: (
            <Text size="sm">
              {t(
                'These scripts are not sandboxed. They can access the device, network, and files available to the selected Root or Shizuku backend. Every run still requires a native one-time approval.'
              )}
            </Text>
          ),
          labels: { confirm: t('Enable'), cancel: t('Cancel') },
          confirmProps: { color: 'red' },
          onConfirm: () => void apply(),
        })
      if (skill.signatureVerified !== true) {
        modals.openConfirmModal({
          title: t('Unsigned script Skill'),
          children: (
            <Text size="sm">
              {t(
                'This Skill package has no verified publisher signature. Its hash protects the downloaded bytes from later changes, but does not establish who authored them.'
              )}
            </Text>
          ),
          labels: { confirm: t('Continue'), cancel: t('Cancel') },
          confirmProps: { color: 'red' },
          onConfirm: confirmUnrestrictedExecution,
        })
        return
      }
      confirmUnrestrictedExecution()
    },
    [fetchSkills, t]
  )

  return (
    <>
      <Flex justify="space-between" align="center" mb="lg" wrap="wrap" gap="xs">
        <Flex align="center" gap="xs">
          <Button
            variant="light"
            size="xs"
            leftSection={<ScalableIcon icon={IconPlus} size={14} />}
            onClick={skillsSpotlight.open}
          >
            {t('Add Skills')}
          </Button>
          <Button
            variant="subtle"
            size="xs"
            color="gray"
            leftSection={<ScalableIcon icon={IconBrandGithub} size={14} />}
            onClick={() => setShowGithubInput((v) => !v)}
          >
            {t('Install from GitHub')}
          </Button>
        </Flex>

        <Flex align="center" gap="xs">
          {isTranslating && <Loader size="xs" />}
          <Switch size="xs" label={t('Translate')} checked={translationEnabled} onChange={() => toggleTranslation()} />
        </Flex>
      </Flex>

      {showGithubInput && (
        <Paper radius="md" withBorder p="sm" mb="lg" className="bg-chatbox-background-gray-secondary/30">
          <Flex align="center" gap={8} mb={8}>
            <ScalableIcon icon={IconBrandGithub} size={16} className="text-chatbox-tint-tertiary" />
            <Text size="xs" fw={500}>
              {t('Install from GitHub Repository')}
            </Text>
          </Flex>
          <Flex gap="xs">
            <TextInput
              size="xs"
              value={githubUrl}
              placeholder="https://github.com/owner/repo"
              onChange={(event) => setGithubUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleScanRepo()
                }
              }}
              flex={1}
            />
            <Button size="xs" loading={scanning} onClick={() => void handleScanRepo()}>
              {t('Scan')}
            </Button>
          </Flex>
        </Paper>
      )}

      <section className="mb-8" aria-label="SkillHub">
        <SectionHeader
          title="SkillHub"
          count={marketplaceSkills.length}
          className="mb-3"
          right={
            <Button
              variant="subtle"
              size="xs"
              leftSection={<ScalableIcon icon={IconWorld} size={14} />}
              onClick={skillsSpotlight.open}
            >
              浏览更多
            </Button>
          }
        />
        <Flex gap="xs" mb="sm">
          <TextInput
            flex={1}
            value={marketplaceQuery}
            placeholder="搜索可安装的 Skills"
            leftSection={<ScalableIcon icon={IconSearch} size={15} />}
            onChange={(event) => setMarketplaceQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void searchMarketplace()
            }}
          />
          <Button loading={marketplaceLoading} onClick={() => void searchMarketplace()}>
            搜索
          </Button>
        </Flex>
        {marketplaceSkills.length === 0 ? (
          <Text size="sm" c="dimmed" py="md">
            没有找到匹配的 Skill
          </Text>
        ) : (
          <SimpleGrid type="container" cols={{ base: 1, '520px': 2, '900px': 3 }}>
            {marketplaceSkills.map((skill) => {
              const expectedNames = [skill.skillId, skill.slug, skill.id.split('/').at(-1)]
                .filter((name): name is string => Boolean(name))
                .map((name) => name.toLowerCase())
              const installed = userSkills.some((item) => expectedNames.includes(item.name.toLowerCase()))
              return (
                <Paper key={skill.id} withBorder radius="md" p="sm">
                  <Flex justify="space-between" align="flex-start" gap="sm">
                    <Box style={{ minWidth: 0 }}>
                      <Text fw={650} size="sm" lineClamp={1}>
                        {skill.name}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={2} mt={4}>
                        {skill.description || skill.source}
                      </Text>
                    </Box>
                    <Button
                      size="compact-xs"
                      variant={installed ? 'light' : 'filled'}
                      disabled={installed}
                      loading={installingMarketplaceSkill === skill.id}
                      leftSection={<ScalableIcon icon={IconDownload} size={13} />}
                      onClick={() => void installMarketplaceSkill(skill)}
                    >
                      {installed ? '已安装' : '安装'}
                    </Button>
                  </Flex>
                  <Flex gap={6} mt="xs" wrap="wrap">
                    <Badge size="xs" variant="light" color="gray">
                      {skill.source}
                    </Badge>
                    {skill.installs > 0 && (
                      <Badge size="xs" variant="light" color="pink">
                        {skill.installs.toLocaleString()} 次安装
                      </Badge>
                    )}
                  </Flex>
                </Paper>
              )
            })}
          </SimpleGrid>
        )}
      </section>

      <SectionHeader
        title={t('User Skills')}
        count={userSkills.length}
        className="mb-3"
        right={
          <>
            <Tooltip label={t('Open Skills Folder')} withArrow openDelay={300}>
              <ActionIcon variant="subtle" size="sm" color="gray" onClick={() => void handleOpenFolder()}>
                <ScalableIcon icon={IconFolderOpen} size={16} />
              </ActionIcon>
            </Tooltip>
            <Button
              variant="subtle"
              size="xs"
              leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
              loading={loading}
              onClick={fetchSkills}
            >
              {t('Refresh')}
            </Button>
          </>
        }
      />

      {userSkills.length === 0 ? (
        <EmptyState onAddClick={skillsSpotlight.open} onOpenFolder={() => void handleOpenFolder()} />
      ) : (
        <SimpleGrid type="container" cols={{ base: 1, '450px': 2, '800px': 3, '1200px': 4 }}>
          {userSkills.map((skill) => {
            const originalSkill = getOriginalUserSkill(skill)
            const actionItems: ActionMenuItemProps[] = [
              ...(originalSkill.source?.capabilityManifest?.scripts
                ? [
                    {
                      text: originalSkill.scriptExecutionEnabled
                        ? t('Disable Script Execution')
                        : t('Enable Script Execution'),
                      icon: originalSkill.scriptExecutionEnabled ? IconPlayerStop : IconPlayerPlay,
                      color: originalSkill.scriptExecutionEnabled ? undefined : 'red',
                      onClick: () => {
                        void handleScriptExecution(originalSkill, !originalSkill.scriptExecutionEnabled)
                      },
                    } satisfies ActionMenuItemProps,
                  ]
                : []),
              {
                text: t('Check Update'),
                icon: IconRefresh,
                onClick: () => {
                  void handleCheckUpdate(originalSkill.name)
                },
              },
              {
                text: t('Delete'),
                icon: IconTrash,
                color: 'red',
                doubleCheck: {
                  text: String(t('Confirm Delete?')),
                  color: 'red',
                },
                onClick: () => {
                  void handleDeleteSkill(originalSkill.name)
                },
              },
            ]

            return (
              <SkillCard
                key={originalSkill.path}
                skill={skill}
                translatedName={getTranslatedName(skill)}
                enabled={skillSettings.enabledSkillNames.includes(originalSkill.name)}
                onToggle={(name, enabled) => handleUserToggle(originalSkill.name || name, enabled)}
                actionItems={actionItems}
              />
            )
          })}
        </SimpleGrid>
      )}

      <GitHubInstallModal
        opened={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        skills={detectedSkills}
        repoOwner={repoInfo.owner}
        repoName={repoInfo.repo}
        onInstallComplete={() => {
          void fetchSkills()
        }}
      />

      <SkillsSpotlight
        installedSkillNames={skills.filter((s) => !s.isBuiltin).map((s) => s.name)}
        onInstallComplete={fetchSkills}
      />
    </>
  )
}
