import { Application } from '@pixi/app'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import JSZip from 'jszip'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Live2DAction, Live2DModelDescriptor } from '@/mobile/live2d-models'
import { getLive2DResolution, type Live2DRenderQuality } from '@/mobile/live2d-performance'

type Cubism4Module = typeof import('pixi-live2d-display/cubism4')
type ModelInstance = Awaited<ReturnType<Cubism4Module['Live2DModel']['from']>>

export interface Live2DStageHandle {
  perform: (action: Live2DAction) => Promise<void>
}

let runtimePromise: Promise<Cubism4Module> | undefined
let pixiRegistered = false

async function ensureCubismRuntime(): Promise<Cubism4Module> {
  if (runtimePromise) return runtimePromise
  runtimePromise = new Promise<void>((resolve, reject) => {
    if ('Live2DCubismCore' in window) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = '/live2d/core/live2dcubismcore.min.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Live2D Cubism Core 加载失败'))
    document.head.appendChild(script)
  }).then(async () => {
    const runtime = await import('pixi-live2d-display/cubism4')
    runtime.ZipLoader.zipReader = (data: Blob) => JSZip.loadAsync(data)
    runtime.ZipLoader.getFilePaths = async (zip: JSZip) =>
      Object.keys(zip.files).filter((path) => !zip.files[path].dir && !path.endsWith('items_pinned_to_model.json'))
    runtime.ZipLoader.getFiles = async (zip: JSZip, paths: string[]) =>
      Promise.all(
        paths.map(async (path) => new File([await zip.file(path)!.async('blob')], path.split('/').pop() || path))
      )
    runtime.ZipLoader.readText = async (zip: JSZip, path: string) => (await zip.file(path)?.async('text')) || ''
    if (!pixiRegistered) {
      extensions.add(TickerPlugin)
      runtime.Live2DModel.registerTicker(Ticker)
      pixiRegistered = true
    }
    return runtime
  })
  return runtimePromise
}

function fitModel(model: ModelInstance, width: number, height: number) {
  const naturalWidth = Math.max(1, model.width / Math.max(model.scale.x, 0.0001))
  const naturalHeight = Math.max(1, model.height / Math.max(model.scale.y, 0.0001))
  const scale = Math.min(width / naturalWidth, height / naturalHeight) * 1.08
  model.anchor.set(0.5, 0.5)
  model.scale.set(scale)
  model.position.set(width / 2, height / 2 + height * 0.04)
}

export const Live2DStage = forwardRef<
  Live2DStageHandle,
  {
    model: Live2DModelDescriptor
    speaking?: boolean
    muted?: boolean
    quality?: Live2DRenderQuality
    onReady?: () => void
  }
>(function Live2DStage({ model: descriptor, speaking = false, muted = false, quality = 'high', onReady }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application>()
  const modelRef = useRef<ModelInstance>()
  const speakingRef = useRef(speaking && !muted)
  const [error, setError] = useState<string>()

  speakingRef.current = speaking && !muted

  useImperativeHandle(ref, () => ({
    perform: async (action) => {
      const instance = modelRef.current
      if (!instance) return
      if (action.kind === 'expression' && action.expressionName) {
        await instance.expression(action.expressionName)
      } else if (action.kind === 'motion' && action.motionGroup) {
        const runtime = await ensureCubismRuntime()
        await instance.motion(action.motionGroup, action.motionIndex ?? 0, runtime.MotionPriority.FORCE)
      }
    },
  }))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let observer: ResizeObserver | undefined

    const initialize = async () => {
      setError(undefined)
      const runtime = await ensureCubismRuntime()
      if (disposed) return
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      const resolution = getLive2DResolution(quality, window.devicePixelRatio)
      const app = new Application({
        width,
        height,
        backgroundAlpha: 0,
        antialias: quality !== 'performance',
        autoDensity: true,
        resolution,
      })
      app.view.style.width = '100%'
      app.view.style.height = '100%'
      app.view.style.display = 'block'
      host.replaceChildren(app.view)
      appRef.current = app

      const instance = await runtime.Live2DModel.from(descriptor.source, { autoInteract: false })
      if (disposed) {
        instance.destroy()
        app.destroy(true)
        return
      }
      modelRef.current = instance
      app.stage.addChild(instance)
      fitModel(instance, width, height)

      // 模型缺少 LipSync 分组时仍尝试标准 Cubism 嘴型参数。
      app.ticker.add(() => {
        const core = instance.internalModel.coreModel as { setParameterValueById: (id: string, value: number) => void }
        const mouth = speakingRef.current ? 0.18 + Math.abs(Math.sin(performance.now() / 82)) * 0.72 : 0
        core.setParameterValueById('ParamMouthOpenY', mouth)
      })

      observer = new ResizeObserver(() => {
        const nextWidth = Math.max(1, host.clientWidth)
        const nextHeight = Math.max(1, host.clientHeight)
        app.renderer.resize(nextWidth, nextHeight)
        fitModel(instance, nextWidth, nextHeight)
      })
      observer.observe(host)
      onReady?.()
    }

    void initialize().catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : 'Live2D 模型加载失败')
    })

    return () => {
      disposed = true
      observer?.disconnect()
      modelRef.current?.destroy()
      modelRef.current = undefined
      appRef.current?.destroy(true, { children: true, texture: true, baseTexture: true })
      appRef.current = undefined
      host.replaceChildren()
    }
  }, [descriptor.id, descriptor.source, quality, onReady])

  return (
    <div
      ref={hostRef}
      className="yachiyo-live2d-stage"
      data-ready={error ? 'false' : 'true'}
      data-speaking={speaking && !muted ? 'true' : 'false'}
    >
      {error && <div className="yachiyo-live2d-error">{error}</div>}
    </div>
  )
})
