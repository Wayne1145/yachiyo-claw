import {
  Anchor,
  Box,
  Button,
  Container,
  Divider,
  Flex,
  Image,
  Progress,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import {
  IconChevronRight,
  IconFileText,
  IconRefresh,
} from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { Fragment, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { YACHIYO_GITHUB_URL, YACHIYO_LATEST_RELEASE_URL, YACHIYO_RELEASES_URL } from '@shared/releases/yachiyo'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import BrandGithub from '@/components/icons/BrandGithub'
import Page from '@/components/layout/Page'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import platform from '@/platform'
import { installUpdate, useUpdateStore } from '@/stores/updateStore'
import iconPNG from '../../../assets/brand/yachiyo-avatar.png'

export const Route = createFileRoute('/about')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const version = useVersion()
  const isSmallScreen = useIsSmallScreen()

  return (
    <Page title={t('About')}>
      <Container size="md" p={0}>
        <Stack gap="xxl" px={isSmallScreen ? 'sm' : 'md'} py={isSmallScreen ? 'xl' : 'md'}>
          <Flex gap="xxl" p="md" className="rounded-lg bg-chatbox-background-secondary">
            <Image h={100} w={100} mah={'20vw'} maw={'20vw'} src={iconPNG} />
            <Stack flex={1} gap="xxs">
              <Flex justify="space-between" align="center" wrap="wrap" gap={isSmallScreen ? 'xs' : 'sm'} rowGap="xs">
                <Title order={5} lh={1.5} lineClamp={1} title={`Yachiyo Claw v${version.version}`}>
                  Yachiyo Claw {/\d/.test(version.version) ? `(v${version.version})` : ''}
                </Title>

                <UpdateSection needCheckUpdate={version.needCheckUpdate} />
              </Flex>
              <Text>Android-first AI chat and local device agent</Text>
              <Text c="chatbox-tertiary">NewDreamStudio · GPL-3.0</Text>
            </Stack>
          </Flex>

          <List>
            <ListItem
              icon={<BrandGithub className="w-full h-full" />}
              title={t('Github')}
              link={YACHIYO_GITHUB_URL}
              value="Wayne1145/yachiyo-claw"
            />
            <ListItem
              icon={<IconFileText className="w-full h-full" />}
              title={t('Changelog')}
              link={YACHIYO_RELEASES_URL}
            />
          </List>
        </Stack>
      </Container>
    </Page>
  )
}

/**
 * Update section in the About page hero.
 * Desktop: check button, progress bar, error/retry, restart & install.
 * Mobile: "New version available" hint linking to app store.
 */
function UpdateSection({ needCheckUpdate }: { needCheckUpdate: boolean }) {
  const isDesktop = platform.type === 'desktop'

  if (isDesktop) {
    return <DesktopUpdateSection />
  }

  // Mobile and Web both use external link
  return <MobileUpdateHint needCheckUpdate={needCheckUpdate} />
}

function MobileUpdateHint({ needCheckUpdate }: { needCheckUpdate: boolean }) {
  const { t } = useTranslation()

  if (needCheckUpdate) {
    return (
      <Button
        size="xs"
        variant="light"
        color="chatbox-brand"
        radius="xl"
        className="flex-shrink-0"
        onClick={() => platform.openLink(YACHIYO_LATEST_RELEASE_URL)}
      >
        {t('New version available')}
      </Button>
    )
  }

  return (
    <Button
      size="xs"
      variant="default"
      radius="xl"
      className="flex-shrink-0"
      onClick={() => platform.openLink(YACHIYO_RELEASES_URL)}
    >
      {t('Check Update')}
    </Button>
  )
}

function DesktopUpdateSection() {
  const { t } = useTranslation()
  const status = useUpdateStore((s) => s.status)
  const progress = useUpdateStore((s) => s.progress)
  const updateVersion = useUpdateStore((s) => s.version)
  const error = useUpdateStore((s) => s.error)

  const handleCheck = async () => {
    useUpdateStore.setState({ status: 'checking', error: null })
    try {
      const result = await platform.checkForUpdate?.()
      // If check was skipped (another check already in progress), reset UI
      if (result && !result.started) {
        const { status: currentStatus } = useUpdateStore.getState()
        if (currentStatus === 'checking') {
          useUpdateStore.setState({ status: 'idle' })
        }
      }
    } catch {
      useUpdateStore.setState({ status: 'idle' })
    }
    // Safety timeout: if still stuck at 'checking' after 30s, reset
    setTimeout(() => {
      if (useUpdateStore.getState().status === 'checking') {
        useUpdateStore.setState({ status: 'idle' })
      }
    }, 30_000)
  }

  const handleInstall = installUpdate

  switch (status) {
    case 'checking':
      return (
        <Button size="xs" variant="default" radius="xl" className="flex-shrink-0" loading>
          {t('Checking...')}
        </Button>
      )

    case 'available':
    case 'downloading':
      return (
        <Stack gap={4} flex={1} maw={200}>
          <Text size="xs" c="chatbox-brand" ta="right">
            {status === 'downloading'
              ? `${t('Downloading...')} ${progress}%`
              : `${t('New version available')}${updateVersion ? ` v${updateVersion}` : ''}`}
          </Text>
          {status === 'downloading' && <Progress value={progress} size="xs" color="chatbox-brand" animated />}
        </Stack>
      )

    case 'downloaded':
      return (
        <Button
          size="xs"
          variant="filled"
          color="chatbox-brand"
          radius="xl"
          className="flex-shrink-0"
          leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
          onClick={handleInstall}
        >
          {t('Restart & Update')}
          {updateVersion ? ` (v${updateVersion})` : ''}
        </Button>
      )

    case 'error':
      return (
        <Stack gap={2} align="flex-end" className="flex-shrink-0">
          <Flex gap="xs" align="center">
            <Text size="xs" c="chatbox-error">
              {t('Update failed')}
            </Text>
            <Button size="xs" variant="default" radius="xl" onClick={handleCheck}>
              {t('Retry')}
            </Button>
          </Flex>
          <Anchor
            size="xs"
            c="chatbox-tertiary"
            onClick={() => platform.openLink(YACHIYO_RELEASES_URL)}
          >
            {t('Download from official site')}
          </Anchor>
        </Stack>
      )

    case 'up-to-date':
      return (
        <Text size="xs" c="chatbox-tertiary" className="flex-shrink-0">
          {t('Already up to date')}
        </Text>
      )

    default:
      return (
        <Button size="xs" variant="default" radius="xl" className="flex-shrink-0" onClick={handleCheck}>
          {t('Check Update')}
        </Button>
      )
  }
}

function List(props: { children: ReactElement[] }) {
  return (
    <Stack gap={0} className="rounded-lg bg-chatbox-background-secondary">
      {props.children.map((child, index) => (
        <Fragment key={`child-${index}`}>
          {child}
          {index !== props.children.length - 1 && <Divider />}
        </Fragment>
      ))}
    </Stack>
  )
}

function ListItem({
  icon,
  title,
  link,
  value,
  right,
}: {
  icon: ReactElement
  title: string
  link?: string
  value?: string
  right?: ReactElement
}) {
  return (
    <Flex
      px="md"
      py="sm"
      gap="xs"
      align="center"
      className={link ? 'cursor-pointer' : ''}
      onClick={() => link && platform.openLink(link)}
      c="chatbox-tertiary"
    >
      <Box w={20} h={20} className="flex-shrink-0 " c="chatbox-primary">
        {icon}
      </Box>
      <Text flex={1} size="md">
        {title}
      </Text>

      {right ? (
        right
      ) : (
        <>
          {value && (
            <Text size="md" c="chatbox-tertiary">
              {value}
            </Text>
          )}
          {link && <ScalableIcon icon={IconChevronRight} size={20} className="!text-inherit" />}
        </>
      )}
    </Flex>
  )
}
