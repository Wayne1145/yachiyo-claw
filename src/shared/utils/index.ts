export * from './json_utils'
export * from './llm_utils'
export * from './network_utils'
export * from './word_count'

// Format numbers with K/M suffixes (for tokens, file sizes, etc.)
export function formatNumber(num: number, unit = ''): string {
  if (num === 0) return `0${unit ? ` ${unit}` : ''}`

  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M${unit ? ` ${unit}` : ''}`
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(0)}K${unit ? ` ${unit}` : ''}`
  }
  return `${num}${unit ? ` ${unit}` : ''}`
}

// Format file sizes with proper binary units (1024-based)
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}
