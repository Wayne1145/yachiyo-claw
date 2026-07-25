import { tool } from 'ai'
import { z } from 'zod'
import platform from '@/platform'

const description = `
<workspace_delivery>
An Android SAF workspace can be imported into the private Linux sandbox and written back after approval.
Use workspace_external_status before syncing. SAF is document-provider synchronization, not a Linux bind mount.
Use workspace_preview for a development server already listening on an Android-loopback port.
Use workspace_deploy only when the user explicitly asks to publish; the configured command always passes through command approval.
</workspace_delivery>

<controlled_browser>
The controlled Android WebView supports HTTPS navigation (plus HTTP loopback preview), CSS-selector click/type, DOM snapshots, and screenshots.
It is not a Playwright Chromium binary. Navigation, click, and type require Tool Broker approval.
</controlled_browser>
`

function unavailable(capability: string) {
  return { success: false, error: `${capability}_unavailable` }
}

export const workspaceBrowserToolSet = {
  description,
  tools: {
    workspace_external_status: tool({
      description: 'Inspect the currently authorized Android SAF external workspace.',
      inputSchema: z.object({}),
      execute: () => platform.externalWorkspaceStatus?.() ?? unavailable('external_workspace'),
    }),
    workspace_sync_from_external: tool({
      description: 'Copy the authorized SAF directory into its matching private Linux sandbox workspace.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!platform.syncExternalWorkspace) return unavailable('external_workspace_sync')
        const result = await platform.syncExternalWorkspace('in')
        if (result.success && result.workspaceKey && platform.sandboxInit) {
          const initialized = await platform.sandboxInit({ workingDirectory: result.workspaceKey })
          if (!initialized.success) return { ...result, success: false, error: initialized.error || 'sandbox_init_failed' }
        }
        return result
      },
    }),
    workspace_sync_to_external: tool({
      description: 'Write added or changed sandbox files to the authorized SAF directory. Existing external files are not automatically deleted.',
      inputSchema: z.object({}),
      execute: () => platform.syncExternalWorkspace?.('out') ?? unavailable('external_workspace_sync'),
    }),
    workspace_export_zip: tool({
      description: 'Create a ZIP archive of the active workspace and optionally open the Android share sheet.',
      inputSchema: z.object({
        name: z.string().max(96).optional(),
        share: z.boolean().default(true),
      }),
      execute: ({ name, share }) => platform.exportWorkspaceZip?.({ name, share }) ?? unavailable('workspace_export'),
    }),
    workspace_preview: tool({
      description: 'Register and open an in-app preview for a server already listening on 127.0.0.1.',
      inputSchema: z.object({
        port: z.number().int().min(1).max(65_535),
        path: z.string().regex(/^\/(?!.*\\)/).max(2_048).default('/'),
      }),
      execute: async ({ port, path }) => {
        if (!platform.registerWorkspacePreview || !platform.openWorkspacePreview) return unavailable('workspace_preview')
        const preview = await platform.registerWorkspacePreview({ port, path })
        if (!preview.success || !preview.id) return preview
        return platform.openWorkspacePreview(preview.id)
      },
    }),
    workspace_deploy: tool({
      description: 'Run an explicit user-requested deployment command in the Linux sandbox after command approval.',
      inputSchema: z.object({
        command: z.string().min(1).max(8_192),
        timeout: z.number().int().min(1_000).max(900_000).default(300_000),
      }),
      execute: async ({ command, timeout }) => {
        if (!platform.sandboxExec) return unavailable('workspace_deploy')
        return platform.sandboxExec({ command, timeout })
      },
    }),
    browser_navigate: tool({
      description: 'Open an HTTPS URL in the controlled Android WebView. HTTP is allowed only for loopback preview URLs.',
      inputSchema: z.object({ url: z.string().url().max(8_192) }),
      execute: ({ url }) => platform.controlledBrowserNavigate?.(url) ?? unavailable('controlled_browser'),
    }),
    browser_click: tool({
      description: 'Click the first element matching a CSS selector in the controlled browser.',
      inputSchema: z.object({ selector: z.string().min(1).max(2_048) }),
      execute: ({ selector }) => platform.controlledBrowserClick?.(selector) ?? unavailable('controlled_browser'),
    }),
    browser_type: tool({
      description: 'Replace an input value and dispatch input/change events in the controlled browser.',
      inputSchema: z.object({ selector: z.string().min(1).max(2_048), text: z.string().max(100_000) }),
      execute: ({ selector, text }) => platform.controlledBrowserType?.(selector, text) ?? unavailable('controlled_browser'),
    }),
    browser_snapshot: tool({
      description: 'Read the current controlled page URL, title, visible text, and bounded HTML snapshot.',
      inputSchema: z.object({}),
      execute: () => platform.controlledBrowserSnapshot?.() ?? unavailable('controlled_browser'),
    }),
    browser_screenshot: tool({
      description: 'Capture the visible controlled browser viewport as a bounded JPEG base64 payload.',
      inputSchema: z.object({}),
      execute: () => platform.controlledBrowserScreenshot?.() ?? unavailable('controlled_browser'),
    }),
  },
}

export default workspaceBrowserToolSet
