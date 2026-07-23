export function shouldUseDeviceAgent(platformType: string, deviceControlEnabled: boolean): boolean {
  return platformType === 'mobile' && deviceControlEnabled
}

export function createAgentRunId(sessionId: string, assistantMessageId: string): string {
  return `${sessionId}:${assistantMessageId}`
}
