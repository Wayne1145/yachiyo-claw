import { tool } from 'ai'
import { z } from 'zod'
import platform from '@/platform'
import { CORE_AGENT_PRINCIPAL } from '@shared/agent'
import { getActiveAgentSession, requestAgentApproval } from '@/mobile/agent-approval'

const description = `
<workspace_delivery>
An Android SAF workspace can be imported into the private Linux sandbox and written back after approval.
Use workspace_external_status before syncing. SAF is document-provider synchronization, not a Linux bind mount.
Use workspace_preview to register a development server already listening on an Android-loopback port; it does not open a visible page by default. Validate it with browser_navigate/browser_snapshot. Set open=true only when the user explicitly asks to view it; opening requires approval.
Use workspace_deploy only when the user explicitly asks to publish; the configured command always passes through command approval.
</workspace_delivery>

<controlled_browser>
The controlled offscreen Android WebView supports HTTPS navigation (plus HTTP loopback preview), semantic snapshots with stable element refs, click/type/select, wait, scroll, history navigation, and screenshots. It runs separately from the user's visible preview and does not switch the foreground Activity.
Call browser_snapshot after navigation and after each state-changing action. Prefer element refs from the latest snapshot over CSS selectors.
It is not a Playwright Chromium binary. Navigation and state-changing actions require Tool Broker approval.
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
          if (!initialized.success)
            return { ...result, success: false, error: initialized.error || 'sandbox_init_failed' }
        }
        return result
      },
    }),
    workspace_sync_to_external: tool({
      description:
        'Write added or changed sandbox files to the authorized SAF directory. Existing external files are not automatically deleted.',
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
      description:
        'Register a preview URL for a server on 127.0.0.1 without showing a page. Use browser_navigate to inspect it in the background. Set open=true only for an explicit user request to show the preview.',
      inputSchema: z.object({
        port: z.number().int().min(1).max(65_535),
        path: z
          .string()
          .regex(/^\/(?!.*\\)/)
          .max(2_048)
          .default('/'),
        open: z.boolean().default(false),
      }),
      execute: async ({ port, path, open = false }) => {
        if (!platform.registerWorkspacePreview) return unavailable('workspace_preview')
        const preview = await platform.registerWorkspacePreview({ port, path })
        if (!preview.success || !preview.id) return preview
        if (!open) return { ...preview, opened: false }
        if (!platform.openWorkspacePreview) return unavailable('workspace_preview')
        const approved = await requestAgentApproval({
          principal: CORE_AGENT_PRINCIPAL,
          sessionId: getActiveAgentSession() || 'workspace-preview',
          title: '打开网页预览',
          detail: preview.url || `http://127.0.0.1:${port}${path}`,
          risk: 'dangerous',
        })
        if (!approved) return { ...preview, opened: false, error: 'user_denied_preview' }
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
      description:
        'Navigate the controlled offscreen browser without opening visible UI. HTTP is allowed only for loopback preview URLs; other URLs require HTTPS.',
      inputSchema: z.object({ url: z.string().url().max(8_192) }),
      execute: ({ url }) => platform.controlledBrowserNavigate?.(url) ?? unavailable('controlled_browser'),
    }),
    browser_click: tool({
      description:
        'Click an element using its stable ref from the latest browser_snapshot. CSS selector is a fallback.',
      inputSchema: z
        .object({
          ref: z.string().min(1).max(120).optional(),
          selector: z.string().min(1).max(2_048).optional(),
        })
        .refine((input) => Boolean(input.ref || input.selector), 'ref_or_selector_required'),
      execute: ({ ref, selector }) =>
        platform.controlledBrowserClick?.({ ref, selector }) ?? unavailable('controlled_browser'),
    }),
    browser_type: tool({
      description: 'Replace an input value by stable ref and dispatch input/change events. CSS selector is a fallback.',
      inputSchema: z
        .object({
          ref: z.string().min(1).max(120).optional(),
          selector: z.string().min(1).max(2_048).optional(),
          text: z.string().max(100_000),
        })
        .refine((input) => Boolean(input.ref || input.selector), 'ref_or_selector_required'),
      execute: ({ ref, selector, text }) =>
        platform.controlledBrowserType?.({ ref, selector }, text) ?? unavailable('controlled_browser'),
    }),
    browser_snapshot: tool({
      description:
        'Read URL, title, visible text, and a bounded semantic list of interactive elements with stable refs.',
      inputSchema: z.object({}),
      execute: () => platform.controlledBrowserSnapshot?.() ?? unavailable('controlled_browser'),
    }),
    browser_scroll: tool({
      description: 'Scroll the page or a referenced scrollable element, then return a fresh semantic snapshot.',
      inputSchema: z.object({
        direction: z.enum(['up', 'down']),
        amount: z.number().int().min(100).max(5_000).default(700),
        ref: z.string().min(1).max(120).optional(),
      }),
      execute: (input) =>
        platform.controlledBrowserAction?.({ action: 'scroll', ...input }) ?? unavailable('controlled_browser'),
    }),
    browser_wait: tool({
      description: 'Wait until text, a stable ref, or a CSS selector appears in the controlled page.',
      inputSchema: z.object({
        value: z.string().min(1).max(2_048),
        ref: z.string().min(1).max(120).optional(),
        selector: z.string().min(1).max(2_048).optional(),
        timeoutMs: z.number().int().min(100).max(30_000).default(8_000),
      }),
      execute: (input) =>
        platform.controlledBrowserAction?.({ action: 'wait', ...input }) ?? unavailable('controlled_browser'),
    }),
    browser_select: tool({
      description: 'Select an option in a select element by stable ref or CSS selector.',
      inputSchema: z
        .object({
          value: z.string().max(10_000),
          ref: z.string().min(1).max(120).optional(),
          selector: z.string().min(1).max(2_048).optional(),
        })
        .refine((input) => Boolean(input.ref || input.selector), 'ref_or_selector_required'),
      execute: (input) =>
        platform.controlledBrowserAction?.({ action: 'select', ...input }) ?? unavailable('controlled_browser'),
    }),
    browser_history: tool({
      description: 'Navigate back, forward, or reload, then return a fresh semantic snapshot.',
      inputSchema: z.object({ action: z.enum(['back', 'forward', 'reload']) }),
      execute: ({ action }) => platform.controlledBrowserAction?.({ action }) ?? unavailable('controlled_browser'),
    }),
    browser_screenshot: tool({
      description: 'Capture the visible controlled browser viewport as a bounded JPEG base64 payload.',
      inputSchema: z.object({}),
      execute: () => platform.controlledBrowserScreenshot?.() ?? unavailable('controlled_browser'),
    }),
  },
}

export default workspaceBrowserToolSet
