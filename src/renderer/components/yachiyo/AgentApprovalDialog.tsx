import { Alert, Button, Code, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconShieldCheck } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import {
  type AgentApprovalRequest,
  onAgentApprovalRequest,
  resolveAgentApproval,
} from '@/mobile/agent-approval'

export function AgentApprovalDialog() {
  const [request, setRequest] = useState<AgentApprovalRequest | null>(null)

  useEffect(() => onAgentApprovalRequest(setRequest), [])

  const decide = (decision: 'once' | 'conversation' | 'deny') => {
    if (!request) return
    resolveAgentApproval(request.id, decision)
    setRequest(null)
  }

  return (
    <AdaptiveModal
      opened={Boolean(request)}
      onClose={() => decide('deny')}
      title="Agent 操作审批"
      centered
      size="md"
    >
      {request && (
        <Stack gap="md">
          <Alert
            color={request.risk === 'dangerous' ? 'orange' : 'blue'}
            icon={request.risk === 'dangerous' ? <IconAlertTriangle size={19} /> : <IconShieldCheck size={19} />}
            title={request.title}
          >
            <Text size="sm">
              {request.risk === 'dangerous' ? '此操作可能修改系统、应用或用户数据。' : 'Agent 请求执行一项设备操作。'}
            </Text>
          </Alert>
          <Code block className="yachiyo-approval-detail">
            {request.detail}
          </Code>
          <Text size="xs" c="dimmed">
            “此对话允许”仅作用于当前对话，可以在 Agent 设置中重新恢复审批。
          </Text>
          <div className="yachiyo-approval-actions">
            <Button variant="default" onClick={() => decide('deny')}>拒绝</Button>
            <Button variant="light" onClick={() => decide('once')}>仅本次允许</Button>
            <Button onClick={() => decide('conversation')}>此对话允许</Button>
          </div>
        </Stack>
      )}
    </AdaptiveModal>
  )
}
