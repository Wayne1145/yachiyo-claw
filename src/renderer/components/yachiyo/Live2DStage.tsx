import { Application } from '@pixi/app'
import { ShaderSystem } from '@pixi/core'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { install as installUnsafeEval } from '@pixi/unsafe-eval'
import JSZip from 'jszip'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Live2DAction, Live2DModelDescriptor } from '@/mobile/live2d-models'
import { getLive2DResolution, type Live2DRenderQuality, resolveLive2DAssetUrl } from '@/mobile/live2d-performance'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

type Cubism4Module = typeof import('pixi-live2d-display/cubism4')
type ModelInstance = Awaited<ReturnType<Cubism4Module['Live2DModel']['from']>>

export interface Live2DStageHandle {
  perform: (action: Live2DAction) => Promise<void>
}

let runtimePromise: Promise<Cubism4Module> | undefined
let pixiRegistered = false
let unsafeEvalInstalled = false
let cachedWebGLLimits: WebGLLimits | undefined

function ensurePixiUnsafeEval() {
  if (unsafeEvalInstalled) return
  // Live2D shaders are compiled by Pixi. This official adapter keeps that
  // path working in WebView environments where `new Function` is blocked.
  installUnsafeEval({ ShaderSystem })
  unsafeEvalInstalled = true
}

function hasCubismCore(): boolean {
  return Boolean((window as Window & { Live2DCubismCore?: unknown }).Live2DCubismCore)
}

async function loadCubismCore(): Promise<void> {
  if (hasCubismCore()) return

  const script = document.createElement('script')
  script.async = true
  script.dataset.yachiyoLive2dCore = 'true'
  script.src = resolveLive2DAssetUrl('live2d/core/live2dcubismcore.min.js')

  await new Promise<void>((resolve, reject) => {
    script.onload = () => {
      if (hasCubismCore()) resolve()
      else reject(new Error('Live2D Cubism Core 初始化失败'))
    }
    script.onerror = () => reject(new Error('Live2D Cubism Core 加载失败'))
    document.head.appendChild(script)
  }).catch((reason) => {
    script.remove()
    throw reason
  })
}

async function ensureCubismRuntime(): Promise<Cubism4Module> {
  if (runtimePromise) return runtimePromise
  const pending = (async () => {
    await loadCubismCore()
    const runtime = await import('pixi-live2d-display/cubism4')
    runtime.ZipLoader.zipReader = (data: Blob) => JSZip.loadAsync(data)
    runtime.ZipLoader.getFilePaths = async (zip: JSZip) =>
      Object.keys(zip.files).filter((path) => !zip.files[path].dir && !path.endsWith('items_pinned_to_model.json'))
    runtime.ZipLoader.getFiles = async (zip: JSZip, paths: string[]) =>
      Promise.all(
        paths.map(async (path) => {
          const entry = zip.file(path)
          if (!entry) throw new Error(`Live2D ZIP 文件不存在: ${path}`)
          return new File([await entry.async('blob')], path.split('/').pop() || path)
        })
      )
    runtime.ZipLoader.readText = async (zip: JSZip, path: string) => (await zip.file(path)?.async('text')) || ''
    if (!pixiRegistered) {
      extensions.add(TickerPlugin)
      runtime.Live2DModel.registerTicker(Ticker)
      pixiRegistered = true
    }
    return runtime
  })()
  runtimePromise = pending

  try {
    return await pending
  } catch (reason) {
    // Do not permanently cache transient WebView or Cubism load failures.
    if (runtimePromise === pending) runtimePromise = undefined
    throw reason
  }
}

type WebGLLimits = {
  maxRenderbufferSize: number
}

function getWebGLLimits(): WebGLLimits {
  if (cachedWebGLLimits) return cachedWebGLLimits
  const canvas = document.createElement('canvas')
  const context =
    canvas.getContext('webgl2', { alpha: false, antialias: false }) ||
    canvas.getContext('webgl', { alpha: false, antialias: false })
  if (!context) throw new Error('当前 WebView 不支持 WebGL，Live2D 无法显示')

  const maxRenderbufferSize = context.getParameter(context.MAX_RENDERBUFFER_SIZE)
  context.getExtension('WEBGL_lose_context')?.loseContext()
  cachedWebGLLimits = {
    maxRenderbufferSize:
      typeof maxRenderbufferSize === 'number' && maxRenderbufferSize > 0 ? maxRenderbufferSize : 4096,
  }
  return cachedWebGLLimits
}

function isAndroidRuntime(): boolean {
  return (
    CHATBOX_BUILD_PLATFORM === 'android' || (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent))
  )
}

function getQualityCandidates(quality: Live2DRenderQuality): Live2DRenderQuality[] {
  const candidates: Live2DRenderQuality[] =
    quality === 'high'
      ? [quality, 'balanced', 'performance']
      : quality === 'balanced'
        ? [quality, 'performance']
        : [quality]
  return [...new Set(candidates)]
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
  const contextRecoveryCountRef = useRef(0)
  const recoveryModeRef = useRef(false)
  const recoveryIdentityRef = useRef({ source: descriptor.source, quality })
  const [retryKey, setRetryKey] = useState(0)
  const [error, setError] = useState<string>()
  const [ready, setReady] = useState(false)

  speakingRef.current = speaking && !muted
  if (recoveryIdentityRef.current.source !== descriptor.source || recoveryIdentityRef.current.quality !== quality) {
    recoveryIdentityRef.current = { source: descriptor.source, quality }
    recoveryModeRef.current = false
    contextRecoveryCountRef.current = 0
  }

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey triggers one recovery after a lost WebGL context.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let observer: ResizeObserver | undefined
    let rendererCleanup: (() => void) | undefined

    const disposeResources = () => {
      const app = appRef.current
      const instance = modelRef.current
      appRef.current = undefined
      modelRef.current = undefined
      if (app) {
        try {
          app.destroy(true, { children: true, texture: true, baseTexture: true })
        } catch {
          // WebGL may already be lost while the WebView is being torn down.
        }
      } else {
        try {
          instance?.destroy()
        } catch {
          // The model may have failed before its internal renderer was created.
        }
      }
    }

    const initialize = async () => {
      setError(undefined)
      setReady(false)
      ensurePixiUnsafeEval()
      const runtime = await ensureCubismRuntime()
      if (disposed) return
      const limits = getWebGLLimits()
      const android = isAndroidRuntime()
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      const requestedQuality: Live2DRenderQuality = recoveryModeRef.current ? 'performance' : quality
      let lastReason: unknown

      for (const candidate of getQualityCandidates(requestedQuality)) {
        if (disposed) return
        let app: Application | undefined
        let instance: ModelInstance | undefined
        let instanceAdded = false
        let attemptCleanup: (() => void) | undefined

        try {
          const resolution = getLive2DResolution(candidate, window.devicePixelRatio, {
            width,
            height,
            maxRenderbufferSize: limits.maxRenderbufferSize,
            isAndroid: android,
          })
          app = new Application({
            width,
            height,
            backgroundAlpha: 0,
            // Antialiasing is disproportionately expensive in Android WebView.
            antialias: candidate === 'high' && !android,
            autoDensity: true,
            resolution,
          })
          app.view.style.width = '100%'
          app.view.style.height = '100%'
          app.view.style.display = 'block'
          host.replaceChildren(app.view)
          appRef.current = app

          let recoveryTimer: number | undefined
          const onContextLost = (event: Event) => {
            event.preventDefault()
            if (disposed) return
            if (recoveryModeRef.current || contextRecoveryCountRef.current > 0) {
              setError('Live2D 渲染上下文丢失')
              return
            }
            contextRecoveryCountRef.current += 1
            recoveryModeRef.current = true
            recoveryTimer = window.setTimeout(() => {
              if (!disposed) setRetryKey((value) => value + 1)
            }, 250)
          }
          app.view.addEventListener('webglcontextlost', onContextLost)
          attemptCleanup = () => {
            app?.view.removeEventListener('webglcontextlost', onContextLost)
            if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer)
          }

          const loadedInstance = await runtime.Live2DModel.from(resolveLive2DAssetUrl(descriptor.source), {
            autoInteract: false,
          })
          instance = loadedInstance
          if (disposed) {
            loadedInstance.destroy()
            app.destroy(true)
            return
          }
          modelRef.current = loadedInstance
          app.stage.addChild(loadedInstance)
          instanceAdded = true
          fitModel(loadedInstance, width, height)

          // Models without a LipSync group can still use the standard Cubism mouth parameter.
          app.ticker.add(() => {
            const core = loadedInstance.internalModel.coreModel as {
              setParameterValueById: (id: string, value: number) => void
            }
            const mouth = speakingRef.current ? 0.18 + Math.abs(Math.sin(performance.now() / 82)) * 0.72 : 0
            core.setParameterValueById('ParamMouthOpenY', mouth)
          })

          observer = new ResizeObserver(() => {
            const nextWidth = Math.max(1, host.clientWidth)
            const nextHeight = Math.max(1, host.clientHeight)
            if (app) {
              app.renderer.resolution = Math.min(
                app.renderer.resolution,
                getLive2DResolution(candidate, window.devicePixelRatio, {
                  width: nextWidth,
                  height: nextHeight,
                  maxRenderbufferSize: limits.maxRenderbufferSize,
                  isAndroid: android,
                })
              )
              app.renderer.resize(nextWidth, nextHeight)
            }
            fitModel(loadedInstance, nextWidth, nextHeight)
          })
          observer.observe(host)
          rendererCleanup = attemptCleanup
          if (!recoveryModeRef.current) contextRecoveryCountRef.current = 0
          setReady(true)
          onReady?.()
          return
        } catch (reason) {
          lastReason = reason
          attemptCleanup?.()
          observer?.disconnect()
          observer = undefined
          if (modelRef.current === instance) modelRef.current = undefined
          if (appRef.current === app) appRef.current = undefined
          if (instance && !instanceAdded) {
            try {
              instance.destroy()
            } catch {
              // Ignore partial model cleanup and continue with a lower quality.
            }
          }
          if (app) {
            try {
              app.destroy(true, { children: instanceAdded, texture: true, baseTexture: true })
            } catch {
              // Ignore a renderer that failed while its WebGL context was being lost.
            }
          }
        }
      }

      throw lastReason instanceof Error ? lastReason : new Error('Live2D 模型加载失败')
    }

    void initialize().catch((reason) => {
      if (!disposed) {
        setReady(false)
        setError(reason instanceof Error ? reason.message : 'Live2D 模型加载失败')
      }
    })

    return () => {
      disposed = true
      rendererCleanup?.()
      observer?.disconnect()
      disposeResources()
      host.replaceChildren()
    }
  }, [descriptor.source, onReady, quality, retryKey])

  return (
    <div
      ref={hostRef}
      className="yachiyo-live2d-stage"
      data-ready={ready && !error ? 'true' : 'false'}
      data-speaking={speaking && !muted ? 'true' : 'false'}
    >
      {error && <div className="yachiyo-live2d-error">{error}</div>}
    </div>
  )
})
