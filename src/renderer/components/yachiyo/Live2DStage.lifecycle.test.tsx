/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Live2DModelDescriptor } from '@/mobile/live2d-models'
import { Live2DStage, type Live2DStageHandle } from './Live2DStage'

const mocks = vi.hoisted(() => ({
  applications: [] as Array<{
    view: HTMLCanvasElement
    ticker: { add: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
    stage: { addChild: ReturnType<typeof vi.fn> }
    renderer: { resolution: number; resize: ReturnType<typeof vi.fn> }
    destroy: ReturnType<typeof vi.fn>
  }>,
  modelFrom: vi.fn(),
  translate: (key: string) => key,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
}))

vi.mock('@pixi/app', () => ({
  Application: class Application {
    view = document.createElement('canvas')
    ticker = { add: vi.fn(), start: vi.fn(), stop: vi.fn() }
    stage = { addChild: vi.fn() }
    renderer = { resolution: 1, resize: vi.fn() }
    destroy = vi.fn()

    constructor() {
      mocks.applications.push(this)
    }
  },
}))

vi.mock('@pixi/core', () => ({ ShaderSystem: class ShaderSystem {} }))
vi.mock('@pixi/extensions', () => ({ extensions: { add: vi.fn() } }))
vi.mock('@pixi/ticker', () => ({ Ticker: class Ticker {}, TickerPlugin: {} }))
vi.mock('@pixi/unsafe-eval', () => ({ install: vi.fn() }))
vi.mock('pixi-live2d-display/cubism4', () => ({
  Live2DModel: { from: mocks.modelFrom, registerTicker: vi.fn() },
  MotionPriority: { FORCE: 3 },
  ZipLoader: {},
}))
vi.mock('@/mobile/live2d-performance', () => ({
  getLive2DResolution: () => 1,
  resolveLive2DAssetUrl: (path: string) => path,
}))
vi.mock('@/variables', () => ({ CHATBOX_BUILD_PLATFORM: 'android' }))

const descriptor = {
  id: 'lifecycle-model',
  name: 'Lifecycle Model',
  source: 'lifecycle.model3.json',
  actions: [],
  builtIn: true,
} as Live2DModelDescriptor

function createModel() {
  return {
    width: 400,
    height: 800,
    scale: { x: 1, y: 1, set: vi.fn() },
    anchor: { set: vi.fn() },
    position: { set: vi.fn() },
    internalModel: { coreModel: { setParameterValueById: vi.fn() } },
    expression: vi.fn(),
    motion: vi.fn(),
    destroy: vi.fn(),
  }
}

function setDocumentVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('Live2DStage lifecycle', () => {
  beforeEach(() => {
    mocks.applications.length = 0
    mocks.modelFrom.mockReset()
    mocks.modelFrom.mockImplementation(async () => createModel())
    Object.defineProperty(window, 'Live2DCubismCore', { configurable: true, value: {} })
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => ({
        MAX_RENDERBUFFER_SIZE: 0x84e8,
        getParameter: vi.fn(() => 4096),
        getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
      })),
    })
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        disconnect() {}
      }
    )
    setDocumentVisibility('visible')
  })

  it('defers the first preview, keeps an active frame, and rebuilds only after becoming active again', async () => {
    const ref = createRef<Live2DStageHandle>()
    const { container, rerender, unmount } = render(<Live2DStage ref={ref} model={descriptor} activity="preview" />)

    expect(mocks.applications).toHaveLength(0)
    expect(container.querySelector('.yachiyo-live2d-stage')?.getAttribute('data-ready')).toBe('false')
    rerender(<Live2DStage ref={ref} model={descriptor} activity="active" />)

    await waitFor(() => expect(mocks.applications).toHaveLength(1), { timeout: 5000 })
    await waitFor(
      () => expect(container.querySelector('.yachiyo-live2d-stage')?.getAttribute('data-ready')).toBe('true'),
      { timeout: 5000 }
    )
    const first = mocks.applications[0]
    expect(first.ticker.start).toHaveBeenCalled()
    expect(container.querySelector('.yachiyo-live2d-stage')?.getAttribute('data-yachiyo-tab-swipe')).toBe('block')

    rerender(<Live2DStage ref={ref} model={descriptor} activity="preview" />)
    expect(first.ticker.stop).toHaveBeenCalled()
    expect(first.destroy).not.toHaveBeenCalled()
    expect(container.querySelector('canvas')).toBe(first.view)

    rerender(<Live2DStage ref={ref} model={descriptor} activity="active" />)
    expect(first.ticker.start).toHaveBeenCalledTimes(2)
    setDocumentVisibility('hidden')
    expect(first.ticker.stop).toHaveBeenCalledTimes(2)
    setDocumentVisibility('visible')
    expect(first.ticker.start).toHaveBeenCalledTimes(3)

    rerender(<Live2DStage ref={ref} model={descriptor} activity="inactive" />)
    await waitFor(() => expect(first.destroy).toHaveBeenCalledTimes(1))
    expect(container.querySelector('canvas')).toBeNull()

    rerender(<Live2DStage ref={ref} model={descriptor} activity="preview" />)
    expect(mocks.applications).toHaveLength(1)
    expect(container.querySelector('canvas')).toBeNull()

    rerender(<Live2DStage ref={ref} model={descriptor} activity="active" />)
    await waitFor(() => expect(mocks.applications).toHaveLength(2))
    const second = mocks.applications[1]
    unmount()
    expect(second.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys an application only once when unmounted during model loading', async () => {
    const model = createModel()
    let resolveModel: ((value: typeof model) => void) | undefined
    mocks.modelFrom.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveModel = resolve
      })
    )

    const { unmount } = render(<Live2DStage model={descriptor} />)
    await waitFor(() => expect(mocks.applications).toHaveLength(1), { timeout: 5000 })
    const application = mocks.applications[0]
    unmount()
    expect(application.destroy).toHaveBeenCalledTimes(1)

    resolveModel?.(model)
    await waitFor(() => expect(model.destroy).toHaveBeenCalledTimes(1))
    expect(application.destroy).toHaveBeenCalledTimes(1)
  })

  it('keeps React error UI separate from the Pixi canvas host during deactivation', async () => {
    mocks.modelFrom.mockRejectedValue(new Error('model_load_failed'))
    const { container, rerender } = render(<Live2DStage model={descriptor} activity="active" />)

    await waitFor(() => expect(container.querySelector('.yachiyo-live2d-error')).not.toBeNull(), { timeout: 5000 })
    const canvasHost = container.querySelector('.yachiyo-live2d-canvas-host')
    expect(canvasHost).not.toBeNull()
    expect(canvasHost?.querySelector('.yachiyo-live2d-error')).toBeNull()

    expect(() => rerender(<Live2DStage model={descriptor} activity="inactive" />)).not.toThrow()
    await waitFor(() => expect(container.querySelector('.yachiyo-live2d-error')).toBeNull())
  })
})
