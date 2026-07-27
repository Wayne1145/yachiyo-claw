import type { PromptBlock, PromptChannel, PromptContext } from './prompt-contract'

const blocks = new Map<string, PromptBlock>()

function key(block: Pick<PromptBlock, 'featureId' | 'channel' | 'blockName'>): string {
  return `${block.channel}:${block.featureId}:${block.blockName}`
}

export function registerPromptBlock(block: PromptBlock): void {
  const blockKey = key(block)
  if (blocks.has(blockKey)) throw new Error(`Prompt block "${blockKey}" is already registered.`)
  blocks.set(blockKey, block)
}

export function hasPromptBlock(block: Pick<PromptBlock, 'featureId' | 'channel' | 'blockName'>): boolean {
  return blocks.has(key(block))
}

export function resetPromptBlockRegistry(): void {
  blocks.clear()
}

export function getPromptBlocks(channel: PromptChannel): PromptBlock[] {
  return Array.from(blocks.values())
    .filter((block) => block.channel === channel)
    .sort(
      (a, b) => a.order - b.order || a.featureId.localeCompare(b.featureId) || a.blockName.localeCompare(b.blockName),
    )
}

export function renderPromptBlocks(channel: PromptChannel, context: PromptContext): string {
  const rendered: string[] = []
  for (const block of getPromptBlocks(channel)) {
    const enabled = !context.enabledFeatureIds || context.enabledFeatureIds.has(block.featureId)
    const toolsetActive = !block.requiresActiveToolset || Boolean(context.activeToolsetFeatureIds?.has(block.featureId))
    const activeValue = enabled && toolsetActive ? block.render(context) : null
    const value = activeValue || block.renderDisabled?.(context)
    if (value) rendered.push(value)
  }
  return rendered.join('\n\n')
}
