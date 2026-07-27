import { z } from 'zod'

/**
 * Declarative plugin view schema (platform-24).
 *
 * Plugins run in a Worker with no DOM, so they describe UI as JSON and the host renders it with
 * Mantine. The control set mirrors what the built-in yachiyo pages actually use. Deliberately absent —
 * and never to be added: `className`, `style`, inline HTML, component references, callbacks, free
 * layout. Styling freedom is a visual-phishing surface (a plugin could imitate a system dialog);
 * visual consistency with the host is part of the security model.
 *
 * Actions are declarative (`{ type: 'invoke', handler, payload }`) — the host forwards them to the
 * plugin's named handler in the Worker. Nothing in a view is ever evaluated.
 */

export const VIEW_LIMITS = {
  maxDepth: 8,
  maxNodes: 200,
  maxTextLength: 4096,
  maxCodeLength: 16_384,
  maxListItems: 100,
  maxSelectOptions: 64,
} as const

/** Icon names the host maps to Tabler components. Unknown names fall back to a default at render. */
export const PLUGIN_ICON_NAMES = [
  'folder',
  'terminal',
  'settings',
  'info',
  'alert',
  'check',
  'x',
  'download',
  'upload',
  'search',
  'list',
  'file',
  'play',
  'stop',
  'refresh',
  'plus',
  'trash',
  'edit',
  'puzzle',
] as const
export type PluginIconName = (typeof PLUGIN_ICON_NAMES)[number]

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

/** Declarative action: the host forwards it to the plugin's named handler. No code, no eval. */
export const ViewActionSchema = z
  .object({
    type: z.literal('invoke'),
    handler: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Handler must be an identifier'),
    payload: JsonValueSchema.optional(),
  })
  .strict()
export type ViewAction = z.infer<typeof ViewActionSchema>

const KeySchema = z.string().min(1).max(64)
// Icon names are validated loosely here; the renderer falls back to a default for unknown names so a
// newer plugin against an older host degrades instead of failing validation.
const IconSchema = z.string().max(32)

const TextNode = z
  .object({
    type: z.literal('text'),
    key: KeySchema,
    content: z.string().max(VIEW_LIMITS.maxTextLength),
    dimmed: z.boolean().optional(),
    size: z.enum(['xs', 'sm', 'md']).optional(),
  })
  .strict()

const HeadingNode = z
  .object({
    type: z.literal('heading'),
    key: KeySchema,
    content: z.string().max(256),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  .strict()

const ButtonNode = z
  .object({
    type: z.literal('button'),
    key: KeySchema,
    label: z.string().min(1).max(64),
    action: ViewActionSchema,
    variant: z.enum(['primary', 'default', 'danger']).optional(),
    disabled: z.boolean().optional(),
    icon: IconSchema.optional(),
  })
  .strict()

const TextInputNode = z
  .object({
    type: z.literal('textInput'),
    key: KeySchema,
    label: z.string().max(64).optional(),
    placeholder: z.string().max(128).optional(),
    value: z.string().max(VIEW_LIMITS.maxTextLength).optional(),
    /** Fired with `{ value }` merged into the payload when the user commits a change. */
    onChange: ViewActionSchema.optional(),
    secret: z.boolean().optional(),
  })
  .strict()

const TextareaNode = z
  .object({
    type: z.literal('textarea'),
    key: KeySchema,
    label: z.string().max(64).optional(),
    placeholder: z.string().max(128).optional(),
    value: z.string().max(VIEW_LIMITS.maxTextLength).optional(),
    onChange: ViewActionSchema.optional(),
    rows: z.number().int().min(1).max(12).optional(),
  })
  .strict()

const SelectNode = z
  .object({
    type: z.literal('select'),
    key: KeySchema,
    label: z.string().max(64).optional(),
    options: z
      .array(z.object({ value: z.string().max(128), label: z.string().max(128) }).strict())
      .min(1)
      .max(VIEW_LIMITS.maxSelectOptions),
    value: z.string().max(128).optional(),
    onChange: ViewActionSchema.optional(),
  })
  .strict()

const SwitchNode = z
  .object({
    type: z.literal('switch'),
    key: KeySchema,
    label: z.string().min(1).max(128),
    checked: z.boolean().optional(),
    onChange: ViewActionSchema.optional(),
  })
  .strict()

const ListNode = z
  .object({
    type: z.literal('list'),
    key: KeySchema,
    items: z
      .array(
        z
          .object({
            key: KeySchema,
            title: z.string().min(1).max(256),
            description: z.string().max(512).optional(),
            icon: IconSchema.optional(),
            badge: z.string().max(32).optional(),
            action: ViewActionSchema.optional(),
          })
          .strict(),
      )
      .max(VIEW_LIMITS.maxListItems),
  })
  .strict()

const DividerNode = z.object({ type: z.literal('divider'), key: KeySchema }).strict()

const BadgeNode = z
  .object({
    type: z.literal('badge'),
    key: KeySchema,
    label: z.string().min(1).max(32),
    tone: z.enum(['neutral', 'success', 'warning', 'error']).optional(),
  })
  .strict()

const ProgressNode = z
  .object({
    type: z.literal('progress'),
    key: KeySchema,
    value: z.number().min(0).max(100),
    label: z.string().max(128).optional(),
  })
  .strict()

const CodeBlockNode = z
  .object({
    type: z.literal('codeBlock'),
    key: KeySchema,
    content: z.string().max(VIEW_LIMITS.maxCodeLength),
  })
  .strict()

const AlertNode = z
  .object({
    type: z.literal('alert'),
    key: KeySchema,
    tone: z.enum(['info', 'warning', 'error']),
    content: z.string().min(1).max(1024),
  })
  .strict()

export type ViewNode =
  | z.infer<typeof TextNode>
  | z.infer<typeof HeadingNode>
  | z.infer<typeof ButtonNode>
  | z.infer<typeof TextInputNode>
  | z.infer<typeof TextareaNode>
  | z.infer<typeof SelectNode>
  | z.infer<typeof SwitchNode>
  | z.infer<typeof ListNode>
  | z.infer<typeof DividerNode>
  | z.infer<typeof BadgeNode>
  | z.infer<typeof ProgressNode>
  | z.infer<typeof CodeBlockNode>
  | z.infer<typeof AlertNode>
  | { type: 'card'; key: string; title?: string; children: ViewNode[] }

// card is the only container; recursion flows exclusively through it.
const ViewNodeSchema: z.ZodType<ViewNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    TextNode,
    HeadingNode,
    ButtonNode,
    TextInputNode,
    TextareaNode,
    SelectNode,
    SwitchNode,
    ListNode,
    DividerNode,
    BadgeNode,
    ProgressNode,
    CodeBlockNode,
    AlertNode,
    z
      .object({
        type: z.literal('card'),
        key: KeySchema,
        title: z.string().max(128).optional(),
        children: z.array(ViewNodeSchema),
      })
      .strict(),
  ]),
) as z.ZodType<ViewNode>

export const PluginViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().max(64).optional(),
    children: z.array(ViewNodeSchema),
  })
  .strict()
export type PluginView = z.infer<typeof PluginViewSchema>

export class PluginViewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginViewError'
  }
}

interface WalkState {
  nodes: number
}

function walk(nodes: readonly ViewNode[], depth: number, state: WalkState): void {
  if (depth > VIEW_LIMITS.maxDepth) throw new PluginViewError(`View exceeds max depth of ${VIEW_LIMITS.maxDepth}.`)
  const siblingKeys = new Set<string>()
  for (const node of nodes) {
    state.nodes += 1
    if (state.nodes > VIEW_LIMITS.maxNodes)
      throw new PluginViewError(`View exceeds max node count of ${VIEW_LIMITS.maxNodes}.`)
    if (siblingKeys.has(node.key)) throw new PluginViewError(`Duplicate sibling key "${node.key}".`)
    siblingKeys.add(node.key)
    if (node.type === 'card') walk(node.children, depth + 1, state)
  }
}

/** Parses and validates a plugin-supplied view. Throws PluginViewError on structural violations. */
export function parsePluginView(json: unknown): PluginView {
  const parsed = PluginViewSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new PluginViewError(`Invalid view: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'malformed'}`)
  }
  walk(parsed.data.children, 1, { nodes: 0 })
  return parsed.data
}
