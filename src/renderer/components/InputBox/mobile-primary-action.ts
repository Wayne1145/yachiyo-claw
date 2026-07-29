export type MobileComposerPrimaryMode = 'stop' | 'recording' | 'processing' | 'send' | 'speech'

export function resolveMobileComposerPrimaryMode({
  generating,
  speechRecording,
  speechProcessing,
  hasContent,
}: {
  generating: boolean
  speechRecording: boolean
  speechProcessing: boolean
  hasContent: boolean
}): MobileComposerPrimaryMode {
  if (generating) return 'stop'
  if (speechRecording) return 'recording'
  if (speechProcessing) return 'processing'
  if (hasContent) return 'send'
  return 'speech'
}
