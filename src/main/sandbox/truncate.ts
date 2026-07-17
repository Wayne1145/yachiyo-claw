export const DEFAULT_MAX_LINES = 2000
export const DEFAULT_MAX_BYTES = 51200 // 50KB

/** Keep first N lines — for read/ls/grep/find outputs. */
export function headTruncate(
  text: string,
  maxLines: number = DEFAULT_MAX_LINES,
  maxBytes: number = DEFAULT_MAX_BYTES
): string {
  if (!text) return text

  const byteLength = Buffer.byteLength(text, 'utf-8')
  if (byteLength <= maxBytes && text.split('\n').length <= maxLines) {
    return text
  }

  const lines = text.split('\n')
  const totalLines = lines.length

  if (totalLines <= maxLines) {
    let accumulated = 0
    let lineCount = 0
    for (const line of lines) {
      const lineBytes = Buffer.byteLength(line, 'utf-8') + 1
      if (accumulated + lineBytes > maxBytes && lineCount > 0) break
      accumulated += lineBytes
      lineCount++
    }
    const kept = lines.slice(0, lineCount).join('\n')
    return `${kept}\n\n[Output truncated. Showing first ${lineCount} of ${totalLines} lines.]`
  }

  const kept = lines.slice(0, maxLines).join('\n')
  return `${kept}\n\n[Output truncated. Showing first ${maxLines} of ${totalLines} lines.]`
}

/** Keep last N lines — for bash/exec command outputs. */
export function tailTruncate(
  text: string,
  maxLines: number = DEFAULT_MAX_LINES,
  maxBytes: number = DEFAULT_MAX_BYTES
): string {
  if (!text) return text

  const byteLength = Buffer.byteLength(text, 'utf-8')
  if (byteLength <= maxBytes && text.split('\n').length <= maxLines) {
    return text
  }

  const lines = text.split('\n')
  const totalLines = lines.length

  if (totalLines <= maxLines) {
    let accumulated = 0
    let lineCount = 0
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(lines[i], 'utf-8') + 1
      if (accumulated + lineBytes > maxBytes && lineCount > 0) break
      accumulated += lineBytes
      lineCount++
    }
    const kept = lines.slice(totalLines - lineCount).join('\n')
    return `[Output truncated. Showing last ${lineCount} of ${totalLines} lines.]\n\n${kept}`
  }

  const kept = lines.slice(totalLines - maxLines).join('\n')
  return `[Output truncated. Showing last ${maxLines} of ${totalLines} lines.]\n\n${kept}`
}
