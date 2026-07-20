export const ANDROID_MODEL_RESULT_MAX_BYTES = 8 * 1024

export function truncateUtf8(value: string, maxBytes = ANDROID_MODEL_RESULT_MAX_BYTES): string {
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= maxBytes) return value
  let end = maxBytes
  while (end > 0) {
    const clipped = new TextDecoder().decode(encoded.slice(0, end))
    if (new TextEncoder().encode(clipped).byteLength <= maxBytes) return clipped
    end -= 1
  }
  return ''
}

/** Keep a model-facing projection small without mutating the native result. */
export function projectAgentResult<T>(value: T, maxBytes = ANDROID_MODEL_RESULT_MAX_BYTES): T {
  if (typeof value === 'string') return truncateUtf8(value, maxBytes) as T
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => projectAgentResult(item, maxBytes)) as T
  const projected: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    projected[key] = typeof item === 'string' ? truncateUtf8(item, Math.min(maxBytes, 2_048)) : item
  }
  try {
    const serialized = JSON.stringify(projected)
    if (new TextEncoder().encode(serialized).byteLength <= maxBytes) return projected as T
  } catch {
    return { summary: truncateUtf8(String(value), maxBytes) } as T
  }
  return { summary: truncateUtf8(JSON.stringify(projected), maxBytes) } as T
}
