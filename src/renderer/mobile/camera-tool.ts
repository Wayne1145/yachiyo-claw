import { tool } from 'ai'
import { z } from 'zod'
import { CORE_AGENT_PRINCIPAL } from '@shared/agent'
import { requestAgentApproval } from './agent-approval'

export interface CameraCapture {
  data: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  width: number
  height: number
}

export type CameraCaptureProvider = () => Promise<CameraCapture>

const captureProviders = new Map<string, CameraCaptureProvider>()

export function registerCameraCaptureProvider(sessionId: string, provider: CameraCaptureProvider) {
  captureProviders.set(sessionId, provider)
}

export function unregisterCameraCaptureProvider(sessionId: string, provider?: CameraCaptureProvider) {
  if (!provider || captureProviders.get(sessionId) === provider) {
    captureProviders.delete(sessionId)
  }
}

export function getCameraCaptureProvider(sessionId?: string) {
  return sessionId ? captureProviders.get(sessionId) : undefined
}

export function createCameraCaptureTool(sessionId: string) {
  const provider = getCameraCaptureProvider(sessionId)
  if (!provider) return undefined

  return tool({
    description:
      'Capture and inspect one photo from the camera currently selected in the interactive preview. Use this only when a current visual observation would help answer the user.',
    inputSchema: z.object({
      reason: z.string().max(300).optional().describe('A short reason for taking the photo.'),
    }),
    execute: async ({ reason }) => {
      const approved = await requestAgentApproval({
        principal: CORE_AGENT_PRINCIPAL,
        sessionId,
        title: '拍摄并上传当前摄像头画面',
        detail: reason?.trim() || '模型请求查看当前摄像头画面。',
        risk: 'dangerous',
      })
      if (!approved) throw new Error('user_denied_camera_capture')
      // Revocation or switching cameras while approval is open must take effect immediately.
      const currentProvider = getCameraCaptureProvider(sessionId)
      if (!currentProvider) throw new Error('camera_disabled: 请先在交互式页面开启摄像头，再请求查看画面。')
      return currentProvider()
    },
    toModelOutput: ({ output }) => ({
      type: 'content',
      value: [
        { type: 'text', text: `Camera frame captured at ${output.width}x${output.height}.` },
        { type: 'image-data', data: output.data, mediaType: output.mediaType },
      ],
    }),
  })
}
