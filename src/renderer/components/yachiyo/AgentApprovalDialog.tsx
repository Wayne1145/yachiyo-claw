import { Alert, Button, Code, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconShieldCheck } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { type AgentApprovalRequest, onAgentApprovalRequest, resolveAgentApproval } from '@/mobile/agent-approval'

export function AgentApprovalDialog() {
  const { t } = useTranslation()
  const [request, setRequest] = useState<AgentApprovalRequest | null>(null)

  useEffect(() => onAgentApprovalRequest(setRequest), [])

  const decide = (decision: 'once' | 'conversation' | 'deny') => {
    if (!request) return
    resolveAgentApproval(request.id, decision)
    setRequest(null)
  }

  const isLoopWarning = request?.kind === 'loop'

  return (
    <AdaptiveModal
      opened={Boolean(request)}
      onClose={() => decide('deny')}
      title={t(isLoopWarning ? 'Agent 循环保护' : 'Agent 操作审批')}
      centered
      size="md"
    >
      {request && (
        <Stack gap="md">
          <Alert
            color={request.risk === 'dangerous' || isLoopWarning ? 'orange' : 'blue'}
            icon={
              request.risk === 'dangerous' || isLoopWarning ? (
                <IconAlertTriangle size={19} />
              ) : (
                <IconShieldCheck size={19} />
              )
            }
            title={t(request.title)}
          >
            <Text size="sm">
              {isLoopWarning
                ? t('检测到 Agent 可能在重复相同操作，执行已暂停。')
                : request.risk === 'dangerous'
                  ? t('此操作可能修改系统、应用或用户数据。')
                  : t('Agent 请求执行一项设备操作。')}
            </Text>
          </Alert>
          <Code block className="yachiyo-approval-detail">
            {request.detail}
          </Code>
          <Text size="xs" c="dimmed">
            {isLoopWarning
              ? t('“继续一次”允许下一次重复；“更换策略”会要求模型改用不同的方法。')
              : t('“此对话允许”仅作用于当前对话，可以在 Agent 设置中重新恢复审批。')}
          </Text>
          <AdaptiveModal.Actions>
            <Button variant="default" onClick={() => decide('deny')}>
              {t(isLoopWarning ? '停止' : '拒绝')}
            </Button>
            <Button variant="light" onClick={() => decide('once')}>
              {t(isLoopWarning ? '继续一次' : '仅本次允许')}
            </Button>
            <Button onClick={() => decide('conversation')}>{t(isLoopWarning ? '更换策略' : '此对话允许')}</Button>
          </AdaptiveModal.Actions>
        </Stack>
      )}
    </AdaptiveModal>
  )
}
