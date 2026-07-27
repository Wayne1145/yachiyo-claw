import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Divider,
  PasswordInput,
  Progress,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core'
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconEdit,
  IconFile,
  IconFolder,
  IconInfoCircle,
  IconList,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconPuzzle,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTerminal2,
  IconTrash,
  IconUpload,
  IconX,
  type TablerIcon,
} from '@tabler/icons-react'
import { memo, useState } from 'react'
import type { PluginView, ViewAction, ViewNode } from '@shared/plugins/view-schema'

/**
 * Renders a validated plugin view (platform-24).
 *
 * Security invariants:
 * - Every plugin string renders as plain text (React escapes by default; nothing here uses
 *   dangerouslySetInnerHTML or markdown).
 * - Icons resolve through a fixed name→component map; unknown names fall back to a default.
 * - Actions are forwarded to `onAction` as data — never executed here.
 * - Unknown node types render a placeholder instead of crashing the page.
 */

const ICONS: Record<string, TablerIcon> = {
  folder: IconFolder,
  terminal: IconTerminal2,
  settings: IconSettings,
  info: IconInfoCircle,
  alert: IconAlertTriangle,
  check: IconCheck,
  x: IconX,
  download: IconDownload,
  upload: IconUpload,
  search: IconSearch,
  list: IconList,
  file: IconFile,
  play: IconPlayerPlay,
  stop: IconPlayerStop,
  refresh: IconRefresh,
  plus: IconPlus,
  trash: IconTrash,
  edit: IconEdit,
  puzzle: IconPuzzle,
}

function NodeIcon({ name, size = 16 }: { name?: string; size?: number }) {
  if (!name) return null
  const Icon = ICONS[name] ?? IconPuzzle
  return <Icon size={size} />
}

export type ViewActionHandler = (action: ViewAction, extra?: Record<string, unknown>) => void

const BUTTON_VARIANTS = { primary: 'filled', default: 'default', danger: 'filled' } as const
const BADGE_TONES = { neutral: 'gray', success: 'green', warning: 'yellow', error: 'red' } as const
const ALERT_TONES = { info: 'blue', warning: 'yellow', error: 'red' } as const

/** Controlled input whose draft state lives host-side; the plugin is notified on commit (blur/enter). */
function DraftInput({
  node,
  onAction,
}: {
  node: Extract<ViewNode, { type: 'textInput' | 'textarea' }>
  onAction: ViewActionHandler
}) {
  const [draft, setDraft] = useState(node.value ?? '')
  const commit = () => {
    if (node.onChange && draft !== node.value) onAction(node.onChange, { value: draft })
  }
  const shared = {
    label: node.label,
    placeholder: node.placeholder,
    value: draft,
    onBlur: commit,
  }
  if (node.type === 'textarea') {
    return <Textarea {...shared} minRows={node.rows ?? 3} onChange={(event) => setDraft(event.currentTarget.value)} />
  }
  if (node.secret) {
    return <PasswordInput {...shared} onChange={(event) => setDraft(event.currentTarget.value)} />
  }
  return (
    <TextInput
      {...shared}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
      }}
    />
  )
}

function RenderNode({ node, onAction }: { node: ViewNode; onAction: ViewActionHandler }): React.JSX.Element {
  switch (node.type) {
    case 'text':
      return (
        <Text size={node.size ?? 'sm'} c={node.dimmed ? 'dimmed' : undefined}>
          {node.content}
        </Text>
      )
    case 'heading':
      return <Title order={((node.level ?? 2) + 2) as 3 | 4 | 5}>{node.content}</Title>
    case 'button':
      return (
        <Button
          variant={BUTTON_VARIANTS[node.variant ?? 'default']}
          color={node.variant === 'danger' ? 'red' : undefined}
          disabled={node.disabled}
          leftSection={<NodeIcon name={node.icon} />}
          onClick={() => onAction(node.action)}
        >
          {node.label}
        </Button>
      )
    case 'textInput':
    case 'textarea':
      return <DraftInput node={node} onAction={onAction} />
    case 'select':
      return (
        <Select
          label={node.label}
          data={node.options}
          value={node.value ?? null}
          onChange={(value) => {
            if (node.onChange && value !== null) onAction(node.onChange, { value })
          }}
        />
      )
    case 'switch':
      return (
        <Switch
          label={node.label}
          checked={node.checked ?? false}
          onChange={(event) => {
            if (node.onChange) onAction(node.onChange, { checked: event.currentTarget.checked })
          }}
        />
      )
    case 'list':
      return (
        <Stack gap={4}>
          {node.items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="yachiyo-settings-item"
              disabled={!item.action}
              onClick={() => item.action && onAction(item.action)}
            >
              <span className="yachiyo-settings-icon">
                <NodeIcon name={item.icon} size={20} />
              </span>
              <span className="yachiyo-settings-copy">
                <strong>{item.title}</strong>
                {item.description && <small>{item.description}</small>}
              </span>
              {item.badge && <Badge size="sm">{item.badge}</Badge>}
            </button>
          ))}
        </Stack>
      )
    case 'card':
      return (
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            {node.title && <Text fw={650}>{node.title}</Text>}
            {node.children.map((child) => (
              <RenderNode key={child.key} node={child} onAction={onAction} />
            ))}
          </Stack>
        </Card>
      )
    case 'divider':
      return <Divider />
    case 'badge':
      return <Badge color={BADGE_TONES[node.tone ?? 'neutral']}>{node.label}</Badge>
    case 'progress':
      return (
        <Stack gap={4}>
          {node.label && (
            <Text size="xs" c="dimmed">
              {node.label}
            </Text>
          )}
          <Progress value={node.value} />
        </Stack>
      )
    case 'codeBlock':
      return (
        <Code block style={{ maxHeight: 320, overflow: 'auto' }}>
          {node.content}
        </Code>
      )
    case 'alert':
      return (
        <Alert color={ALERT_TONES[node.tone]} icon={<IconInfoCircle size={16} />}>
          {node.content}
        </Alert>
      )
    default:
      // Unknown node from a newer plugin SDK: degrade to a placeholder, never crash the page.
      return (
        <Text size="xs" c="dimmed">
          [不支持的视图节点]
        </Text>
      )
  }
}

export interface ViewRendererProps {
  view: PluginView
  onAction: ViewActionHandler
}

export const ViewRenderer = memo(function ViewRenderer({ view, onAction }: ViewRendererProps) {
  return (
    <Stack gap="md">
      {view.children.map((node) => (
        <RenderNode key={node.key} node={node} onAction={onAction} />
      ))}
    </Stack>
  )
})
