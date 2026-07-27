import { ActionIcon, Box, Flex, Stack, Text } from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconBox,
  IconCategory,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconInfoCircle,
  IconKeyboard,
  IconMessages,
} from '@tabler/icons-react'
import { createFileRoute, Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import { useMemo } from 'react'
import Divider from '@/components/common/Divider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import Page from '@/components/layout/Page'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { registerBuiltinFeatureUi } from '@/features/builtin-feature-ui'
import { registerBuiltinFeatures } from '@/features/builtin-features'
import { resolveRendererFeaturePlatform } from '@/features/feature-runtime'
import { getSettingsEntries } from '@/features/ui-registry'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

const CORE_ITEMS = [
  {
    key: 'provider',
    label: 'Model Provider',
    icon: <IconCategory className="w-full h-full" />,
  },
  {
    key: 'default-models',
    label: 'Default Models',
    icon: <IconBox className="w-full h-full" />,
  },
  {
    key: 'document-parser',
    label: 'Document Parser',
    icon: <IconFileText className="w-full h-full" />,
  },
  {
    key: 'chat',
    label: 'Chat Settings',
    icon: <IconMessages className="w-full h-full" />,
  },
  ...(platform.type === 'mobile'
    ? []
    : [
        {
          key: 'hotkeys',
          label: 'Keyboard Shortcuts',
          icon: <IconKeyboard className="w-full h-full" />,
        },
      ]),
  {
    key: 'general',
    label: 'General Settings',
    icon: <IconAdjustmentsHorizontal className="w-full h-full" />,
  },
]

const DESKTOP_ITEM_ORDER: Readonly<Record<string, number>> = {
  provider: 100,
  'default-models': 200,
  'web-search': 300,
  mcp: 400,
  'knowledge-base': 500,
  skills: 600,
  'document-parser': 700,
  'user-memory': 800,
  chat: 900,
  hotkeys: 1000,
  general: 1100,
}

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const isSmallScreen = useIsSmallScreen()

  return (
    <Page
      title={t('Settings')}
      left={
        isSmallScreen && canGoBack ? (
          <ActionIcon
            className="controls"
            variant="subtle"
            size={28}
            color="chatbox-secondary"
            mr="sm"
            onClick={() => router.history.back()}
          >
            <IconChevronLeft />
          </ActionIcon>
        ) : undefined
      }
    >
      <SettingsRoot />
      <Toaster
        richColors
        position="bottom-center"
        style={{ zIndex: 2147483647 }}
        toastOptions={{ style: { zIndex: 2147483647 } }}
      />
    </Page>
  )
}

export function SettingsRoot() {
  const { t } = useTranslation()
  const routerState = useRouterState()
  const key = routerState.location.pathname.split('/')[2]
  const isSmallScreen = useIsSmallScreen()
  const inAndroidAppShell = useInAndroidAppShell()
  const featureOverrides = useSettingsStore((state) => state.featureOverrides)
  const items = useMemo(() => {
    registerBuiltinFeatures()
    registerBuiltinFeatureUi()
    const featurePlatform = resolveRendererFeaturePlatform()
    const contributed = (['model', 'capability', 'app'] as const)
      .flatMap((group) => getSettingsEntries(group, { platform: featurePlatform, overrides: featureOverrides }))
      .map((entry) => {
        const Icon = entry.icon
        return {
          key: entry.route.replace(/^\/settings\//, ''),
          label: entry.desktopLabel ?? entry.label,
          icon: <Icon className="w-full h-full" />,
        }
      })
    return [...CORE_ITEMS, ...contributed].sort(
      (a, b) => (DESKTOP_ITEM_ORDER[a.key] ?? 10_000) - (DESKTOP_ITEM_ORDER[b.key] ?? 10_000)
    )
  }, [featureOverrides])

  if (inAndroidAppShell) {
    return (
      <Box h="100%" className="overflow-auto">
        <Outlet />
      </Box>
    )
  }

  return (
    <Flex flex={1} h="100%" miw={isSmallScreen ? undefined : 800}>
      {(!isSmallScreen || routerState.location.pathname === '/settings') && (
        <Stack
          p={isSmallScreen ? 0 : 'xs'}
          gap={isSmallScreen ? 0 : 'xs'}
          maw={isSmallScreen ? undefined : 256}
          className={clsx(
            'border-solid border-0 border-r overflow-auto border-chatbox-border-primary',
            isSmallScreen ? 'w-full border-r-0' : 'flex-[1_0_auto]'
          )}
        >
          {items.map((item) => (
            <Link
              disabled={
                routerState.location.pathname === `/settings/${item.key}` ||
                routerState.location.pathname.startsWith(`/settings/${item.key}/`)
              }
              key={item.key}
              to={`/settings/${item.key}` as any}
              className={'block no-underline w-full'}
            >
              <Flex
                component="span"
                gap="xs"
                p="md"
                pr="xl"
                py={isSmallScreen ? 'sm' : undefined}
                align="center"
                c={item.key === key ? 'chatbox-brand' : 'chatbox-secondary'}
                bg={item.key === key ? 'var(--chatbox-background-brand-secondary)' : 'transparent'}
                className={clsx(
                  ' cursor-pointer select-none rounded-md',
                  item.key === key ? '' : 'hover:!bg-chatbox-background-gray-secondary'
                )}
              >
                <Box component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                  {item.icon}
                </Box>
                <Text
                  flex={1}
                  lineClamp={1}
                  span={true}
                  className={`!text-inherit ${isSmallScreen ? 'min-h-[32px] leading-[32px]' : ''}`}
                >
                  {t(item.label)}
                </Text>
                {isSmallScreen && (
                  <ScalableIcon icon={IconChevronRight} size={20} className="!text-chatbox-tint-tertiary" />
                )}
              </Flex>

              {isSmallScreen && <Divider />}
            </Link>
          ))}

          {isSmallScreen && (
            <Link to={`/about`} className={'block no-underline w-full'}>
              <Flex
                component="span"
                gap="xs"
                p="md"
                pr="xl"
                py="sm"
                align="center"
                c={'chatbox-secondary'}
                className={clsx(' cursor-pointer select-none rounded-md')}
              >
                <Box component="span" flex="0 0 auto" w={20} h={20} mr="xs">
                  <ScalableIcon icon={IconInfoCircle} size={20} />
                </Box>
                <Text
                  flex={1}
                  lineClamp={1}
                  span={true}
                  className={`!text-inherit ${isSmallScreen ? 'min-h-[32px] leading-[32px]' : ''}`}
                >
                  {t('About')}
                </Text>
                <ScalableIcon icon={IconChevronRight} size={20} className="!text-chatbox-tint-tertiary" />
              </Flex>

              {isSmallScreen && <Divider />}
            </Link>
          )}
        </Stack>
      )}
      {!(isSmallScreen && routerState.location.pathname === '/settings') && (
        <Box flex="1 1 80%" className="overflow-auto">
          <Outlet />
        </Box>
      )}
    </Flex>
  )
}
