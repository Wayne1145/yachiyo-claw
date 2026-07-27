function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sessionPromptBlockMarkers(blockName: string) {
  return {
    start: `<!-- ${blockName}:start -->`,
    end: `<!-- ${blockName}:end -->`,
  }
}

/** Replaces one delimited session block without accumulating duplicate state across repeated renders. */
export function replaceSessionPromptBlock(content: string, blockName: string, rendered: string | null): string {
  const { start, end } = sessionPromptBlockMarkers(blockName)
  const oldBlock = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'g')
  const base = content.replace(oldBlock, '').trim()
  return rendered ? `${base}\n\n${start}\n${rendered}\n${end}` : base
}
