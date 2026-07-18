import { afterEach, describe, expect, it, vi } from 'vitest'

const requestAgentApprovalMock = vi.hoisted(() => vi.fn(async () => true))
vi.mock('./agent-approval', () => ({ requestAgentApproval: requestAgentApprovalMock }))
import {
  type CameraCapture,
  createCameraCaptureTool,
  registerCameraCaptureProvider,
  unregisterCameraCaptureProvider,
} from './camera-tool'

const SESSION_ID = 'camera-tool-test-session'

afterEach(() => unregisterCameraCaptureProvider(SESSION_ID))

describe('interactive camera tool', () => {
  it('is unavailable without an active preview provider', () => {
    expect(createCameraCaptureTool(SESSION_ID)).toBeUndefined()
  })

  it('returns the current frame as multimodal image data', async () => {
    const capture = vi.fn(async () => ({
      data: 'dGVzdC1mcmFtZQ==',
      mediaType: 'image/jpeg' as const,
      width: 1280,
      height: 720,
    }))
    registerCameraCaptureProvider(SESSION_ID, capture)
    const cameraTool = createCameraCaptureTool(SESSION_ID)
    expect(cameraTool).toBeDefined()
    if (!cameraTool) throw new Error('camera tool was not created')

    const execute = cameraTool.execute as (input: unknown, options: unknown) => Promise<CameraCapture>
    const output = await execute({}, {})
    expect(requestAgentApprovalMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, risk: 'dangerous' })
    )
    expect(capture).toHaveBeenCalledOnce()
    expect(output).toMatchObject({ width: 1280, height: 720 })

    const modelOutput = await cameraTool.toModelOutput?.({
      toolCallId: 'tool-call-1',
      input: {},
      output,
    })
    expect(modelOutput).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Camera frame captured at 1280x720.' },
        { type: 'image-data', data: 'dGVzdC1mcmFtZQ==', mediaType: 'image/jpeg' },
      ],
    })
  })
})
