import { AgentApprovalDialog } from '@/components/yachiyo/AgentApprovalDialog'
import { AndroidPermissionWizard } from '@/components/yachiyo/AndroidPermissionWizard'
import { AndroidScheduledTaskRunner } from '@/components/yachiyo/AndroidScheduledTasks'
import { hasFeatureOverlays, registerFeatureOverlays } from './ui-registry'

export function registerBuiltinFeatureOverlays(): void {
  // Preserve the existing mount order: task runner, permission wizard, approval dialog.
  if (!hasFeatureOverlays('tasks')) registerFeatureOverlays('tasks', [AndroidScheduledTaskRunner])
  if (!hasFeatureOverlays('core')) registerFeatureOverlays('core', [AndroidPermissionWizard, AgentApprovalDialog])
}
