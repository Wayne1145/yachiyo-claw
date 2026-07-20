import { getBuiltinServerConfig } from '@/packages/mcp/builtin'
import { mcpController } from '@/packages/mcp/controller'
import { initSettingsStore, settingsStore } from '@/stores/settingsStore'
import { NODE_ENV } from '@/variables'

function monitorServerStatus() {
  setInterval(() => {
    console.debug(
      'MCP Servers:',
      JSON.stringify(
        Array.from(mcpController.servers.values()).map(({ config, instance: server }) => {
          return {
            id: config.id,
            name: config.name,
            status: server.status,
          }
        }),
        null,
        2
      )
    )
  }, 10000)
}

initSettingsStore()
  .then((settings) => {
    const { mcp, licenseKey } = settings
    const isNative = Capacitor.isNativePlatform()
    const userServers = isNative
      ? (mcp.servers || []).filter((server) => validateMobileMCPServerConfig(server).success)
      : mcp.servers || []
    if (isNative && userServers.length !== (mcp.servers || []).length) {
      // Remove legacy stdio/inline-secret rows before they can be persisted again on mobile.
      settingsStore.getState().setSettings((draft) => {
        draft.mcp.servers = userServers
      })
    }
    const servers = [
      ...(isNative
        ? []
        : (mcp.enabledBuiltinServers || []).map((id) => getBuiltinServerConfig(id, licenseKey)).filter((s) => !!s)),
      ...userServers,
    ]
    console.info(`mcp bootstrap ${servers.length} servers, with license key: ${!!licenseKey}`)
    mcpController.bootstrap(servers)
    if (NODE_ENV === 'development') {
      monitorServerStatus()
    }
  })
  .catch((err) => {
    console.error('mcp bootstrap error', err)
  })
import { Capacitor } from '@capacitor/core'
import { validateMobileMCPServerConfig } from '@shared/types/mcp'
