import { Box, Title } from '@mantine/core'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { BuiltinServersSection } from '@/components/settings/mcp/BuiltinServersSection'
import CustomServersSection from '@/components/settings/mcp/CustomServersSection'
import { parseServerFromJson } from '@/components/settings/mcp/utils'
import { useInAndroidAppShell } from '@/components/yachiyo/AndroidAppShellContext'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { decodeBase64 } from '@/utils/base64'

const searchSchema = z.object({
  install: z.string().optional(), // b64 encoded config
})

export const Route = createFileRoute('/settings/mcp')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
})

export function RouteComponent() {
  const { t } = useTranslation()
  const inAndroidAppShell = useInAndroidAppShell()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const [installConfig, setInstallConfig] = useState<MCPServerConfig | undefined>(undefined)

  // Handle install parameter from search params
  useEffect(() => {
    if (searchParams.install) {
      try {
        const config = parseServerFromJson(decodeBase64(searchParams.install))
        setInstallConfig(config)
      } catch (err) {
        console.error(err)
      }
      // Clear search params immediately after reading
      navigate({
        to: '/settings/mcp',
        search: {},
        replace: true,
      })
    }
  }, [searchParams.install, navigate])

  return (
    <Box p="md">
      <Title order={5}>{t('MCP Settings')}</Title>
      {!inAndroidAppShell && (
        <Box className="mt-8">
          <BuiltinServersSection />
        </Box>
      )}
      <Box className="mt-8">
        <CustomServersSection installConfig={installConfig} />
      </Box>
    </Box>
  )
}
