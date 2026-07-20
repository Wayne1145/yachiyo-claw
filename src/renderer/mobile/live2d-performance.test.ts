import { describe, expect, it } from 'vitest'
import { getLive2DResolution, resolveLive2DAssetUrl } from './live2d-performance'

describe('Live2D render quality', () => {
  it('caps the device pixel ratio for each quality profile', () => {
    expect(getLive2DResolution('performance', 3)).toBe(1)
    expect(getLive2DResolution('balanced', 3)).toBe(1.75)
    expect(getLive2DResolution('high', 3)).toBe(2.5)
    expect(getLive2DResolution('high', 1.5)).toBe(1.5)
  })

  it('keeps Android and oversized drawing buffers within safe limits', () => {
    expect(getLive2DResolution('high', 3, { isAndroid: true })).toBe(1.5)
    expect(
      getLive2DResolution('high', 3, {
        width: 1080,
        height: 2400,
        maxRenderbufferSize: 4096,
      })
    ).toBeCloseTo(4096 / 2400)
    expect(
      getLive2DResolution('performance', 3, {
        width: 1080,
        height: 2400,
        maxRenderbufferSize: 2048,
      })
    ).toBeCloseTo(2048 / 2400)
  })
})

describe('Live2D asset URLs', () => {
  it('resolves root-style assets beside file and Capacitor entry documents', () => {
    expect(resolveLive2DAssetUrl('/live2d/yachiyo/model.model3.json', 'file:///C:/app/index.html')).toBe(
      'file:///C:/app/live2d/yachiyo/model.model3.json'
    )
    expect(resolveLive2DAssetUrl('/live2d/core/live2dcubismcore.min.js', 'https://localhost/index.html')).toBe(
      'https://localhost/live2d/core/live2dcubismcore.min.js'
    )
  })

  it('preserves custom and remote protocols', () => {
    const source = 'zip://blob:https://localhost/model-id'
    expect(resolveLive2DAssetUrl(source, 'https://localhost/index.html')).toBe(source)
  })
})
