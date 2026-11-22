import type { Message } from '@shared/types'

export interface ProjectPreview {
  url: string
  title?: string
  previewId?: string
}

export function localPreviewUrl(value: unknown): URL | undefined {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !/^http:\/\/(?:127\.0\.0\.1|localhost)(?=[:/?#]|$)/i.test(value)
  )
    return
  try {
    const url = new URL(value)
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.username ||
      url.password ||
      /[\\\s]/.test(value) ||
      Array.from(value).some((character) => character.charCodeAt(0) < 32)
    )
      return
    url.hostname = '127.0.0.1'
    return url
  } catch {
    return
  }
}

export function messageProjectPreviews(message: Pick<Message, 'role' | 'contentParts'>): ProjectPreview[] {
  if (message.role !== 'assistant') return []
  const previews = new Map<string, ProjectPreview>()
  const add = (address: unknown, title?: string, previewId?: string) => {
    const url = localPreviewUrl(address)
    if (!url) return
    const previous = previews.get(url.href)
    previews.set(url.href, {
      url: url.href,
      title: previous?.title || title,
      previewId: previous?.previewId || previewId,
    })
  }
  for (const part of message.contentParts) {
    if (part.type === 'tool-call' && part.state === 'result' && part.toolName === 'workspace_preview') {
      const result = part.result
      if (
        result &&
        typeof result === 'object' &&
        'success' in result &&
        result.success === true &&
        'url' in result &&
        !('error' in result && result.error)
      ) {
        add(result.url, undefined, 'id' in result && typeof result.id === 'string' ? result.id : undefined)
      }
    } else if (part.type === 'text') {
      // Older conversations often contain only a delivery link. Code examples should stay examples.
      const prose = part.text.replace(/(```|~~~)[\s\S]*?(?:\1|$)|`[^`\n]+`/g, '')
      const links = /\[([^\]\n]{1,100})\]\((http:\/\/[^\s)]+)\)|<(http:\/\/[^\s<>]+)>/gi
      for (const match of prose.matchAll(links)) add(match[2] || match[3], match[1])
    }
  }
  return [...previews.values()]
}
