import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8')

const approvalSource = read('AgentApprovalDialog.tsx')
const agentConfigurationSource = read('AgentConfigurationPanel.tsx')
const agentSessionSource = read('AgentSessionControls.tsx')
const permissionSource = read('AndroidPermissionWizard.tsx')
const scheduledSource = read('AndroidScheduledTasks.tsx')
const localModelSource = read('LocalModelCenter.tsx')
const updateSource = read('MobileUpdateDialog.tsx')
const workspaceDeliverySource = read('AndroidWorkspaceDeliveryPanel.tsx')
const workspaceSource = read('AndroidWorkspaceHome.tsx')
const shellStyles = read('android-app-shell.css')
const adaptiveStyles = read('adaptive-action-cluster.css')

describe('Android adaptive action group contracts', () => {
  it('keeps approval and scheduled-task modal actions container-driven', () => {
    expect(approvalSource).toContain('<AdaptiveModal.Actions>')
    expect(approvalSource).not.toContain('className="yachiyo-approval-actions"')
    expect(scheduledSource).toContain('<AdaptiveModal')
    expect(scheduledSource).toContain('<AdaptiveModal.Actions>')
    expect(scheduledSource).not.toContain('<Group justify="flex-end">')
  })

  it('collapses Agent and workspace commands without duplicating interactive controls', () => {
    expect(agentConfigurationSource).toContain('<AdaptiveActionCluster')
    expect(agentConfigurationSource).toContain("collapseStrategy: 'icon-then-overflow'")
    expect(agentSessionSource).toContain('className="yachiyo-agent-header-actions"')
    expect(agentSessionSource).toContain("collapseStrategy: 'icon'")
    expect(agentSessionSource).toContain("collapseStrategy: 'keep'")
    expect(workspaceDeliverySource).toContain('<AdaptiveActionCluster')
    expect(workspaceDeliverySource).toContain("collapseStrategy: 'keep'")
    expect(workspaceDeliverySource).toContain("collapseStrategy: 'overflow'")
  })

  it('keeps Android local-model cards to one primary action plus semantic overflow', () => {
    expect(localModelSource).toContain('className="local-model-queue-actions"')
    expect(localModelSource).toContain('className="local-model-detail-actions"')
    expect(localModelSource).toContain("collapseStrategy: 'overflow' as const")
    expect(localModelSource).toContain("collapseStrategy: 'keep' as const")
  })

  it('uses the Android adaptive sheet for updates while preserving the non-Android Modal branch', () => {
    expect(updateSource).toContain('shouldUseAndroidAppShell')
    expect(updateSource).toContain('<AndroidAppShellContext.Provider value>')
    expect(updateSource).toContain('<AdaptiveModal.Actions>')
    expect(updateSource).toContain('<Modal opened={opened}')
  })

  it('measures action-bearing status rows and retains safe permission geometry', () => {
    expect(workspaceSource).toContain('useAdaptiveControlDensity<HTMLDivElement>')
    expect(workspaceSource).toContain('data-has-action={action')
    expect(shellStyles).toMatch(
      /\.yachiyo-status-row\[data-has-action=['"]true['"]\]:is\(\[data-density=['"]compact['"]\], \[data-density=['"]overflow['"]\]\)[^{]*\{[^}]*flex-wrap:\s*wrap;/s
    )
    expect(permissionSource).toContain('wrap="wrap"')
    expect(permissionSource).toContain('className="yachiyo-permission-action"')
    expect(shellStyles).toMatch(/\.yachiyo-permission-row \.yachiyo-permission-action\s*\{[^}]*min-height:\s*44px;/s)
  })

  it('keeps end-aligned actions measurable when they overflow', () => {
    expect(adaptiveStyles).toMatch(
      /\.yachiyo-adaptive-action-cluster\s*\{[^}]*justify-content:\s*flex-start;[^}]*overflow:\s*hidden;/s
    )
    expect(adaptiveStyles).toMatch(
      /\.yachiyo-adaptive-action-cluster > :first-child\s*\{[^}]*margin-inline-start:\s*auto;/s
    )
    expect(shellStyles).toMatch(
      /\.yachiyo-pager-header-actions > \.yachiyo-mobile-conversation-tools\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*none;/s
    )
  })
})
