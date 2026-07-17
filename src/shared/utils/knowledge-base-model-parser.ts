/**
 * Parse knowledge base model string format: "providerId:modelId"
 * Handles model IDs that contain colons by using the first colon as separator
 */
export function parseKnowledgeBaseModelString(modelString: string): { providerId: string; modelId: string } | null {
  if (!modelString) return null

  const colonIndex = modelString.indexOf(':')
  if (colonIndex === -1) return null

  const providerId = modelString.substring(0, colonIndex)
  const modelId = modelString.substring(colonIndex + 1)

  if (!providerId || !modelId) return null

  return { providerId, modelId }
}
