export function shouldUseDeviceAgent(platformType: string, enabled: boolean): boolean {
  return platformType === 'mobile' && enabled
}

export function createAgentRunId(sessionId: string, assistantMessageId: string): string {
  return `${sessionId}:${assistantMessageId}`
}
