import { Application } from '@pixi/app'
import { ShaderSystem } from '@pixi/core'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { install as installUnsafeEval } from '@pixi/unsafe-eval'
import JSZip from 'jszip'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Live2DAction, Live2DModelDescriptor } from '@/mobile/live2d-models'
import {
  createLive2DError,
  type Live2DErrorPhase,
  type Live2DUserError,
  normalizeLive2DError,
  YachiyoLive2DError,
} from '@/mobile/live2d-errors'
import { getLive2DResolution, type Live2DRenderQuality, resolveLive2DAssetUrl } from '@/mobile/live2d-performance'
import { DEFAULT_LIVE2D_TRANSFORM, type Live2DTransform, normalizeLive2DTransform } from '@/mobile/live2d-transform'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import type { AndroidTabPageActivity } from './android-tab-page-activity'
import { Live2DErrorPanel } from './Live2DErrorPanel'

type Cubism4Module = typeof import('pixi-live2d-display/cubism4')
type ModelInstance = Awaited<ReturnType<Cubism4Module['Live2DModel']['from']>>

export interface Live2DStageHandle {
  perform: (action: Live2DAction) => Promise<void>
  getTransform: () => Live2DTransform
  setTransform: (transform: Live2DTransform) => void
  resetTransform: () => void
}

export interface Live2DStageProps {
  model: Live2DModelDescriptor
  speaking?: boolean
  muted?: boolean
  quality?: Live2DRenderQuality
  activity?: AndroidTabPageActivity
  transform?: Live2DTransform
  editMode?: boolean
  onReady?: () => void
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
      else reject(createLive2DError('L2D-CORE-002'))
    }
    script.onerror = () =>
      reject(createLive2DError('L2D-CORE-001', { resource: 'live2d/core/live2dcubismcore.min.js' }))
    document.head.appendChild(script)
  }).catch((reason) => {
    script.remove()
    throw reason
  })
}

async function ensureCubismRuntime(t: TFunction): Promise<Cubism4Module> {
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
          if (!entry) throw new Error(String(t('Live2D ZIP 文件不存在：{{path}}', { path })))
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
  if (!context) throw createLive2DError('L2D-WEBGL-001')

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

function fitModel(model: ModelInstance, width: number, height: number, transform: Live2DTransform) {
  const naturalWidth = Math.max(1, model.width / Math.max(model.scale.x, 0.0001))
  const naturalHeight = Math.max(1, model.height / Math.max(model.scale.y, 0.0001))
  const scale = Math.min(width / naturalWidth, height / naturalHeight) * 1.08 * transform.scale
  model.anchor.set(0.5, 0.5)
  model.scale.set(scale)
  model.position.set(width / 2 + transform.offsetX * width, height / 2 + height * 0.04 + transform.offsetY * height)
}

export const Live2DStage = forwardRef<Live2DStageHandle, Live2DStageProps>(function Live2DStage(
  {
    model: descriptor,
    speaking = false,
    muted = false,
    quality = 'high',
    activity = 'active',
    transform,
    editMode = false,
    onReady,
  },
  ref
) {
  const { t } = useTranslation()
  // Pixi owns this node's children. Keep React-rendered status UI outside it so
  // renderer teardown cannot remove a node that React still expects to own.
  const hostRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application>()
  const modelRef = useRef<ModelInstance>()
  const activityRef = useRef(activity)
  const hasRetainedInstanceRef = useRef(false)
  const speakingRef = useRef(speaking && !muted)
  const contextRecoveryCountRef = useRef(0)
  const recoveryModeRef = useRef(false)
  const recoveryIdentityRef = useRef({ source: descriptor.source, quality })
  const transformRef = useRef(normalizeLive2DTransform(transform ?? DEFAULT_LIVE2D_TRANSFORM))
  const viewportRef = useRef({ width: 1, height: 1 })
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const gestureRef = useRef<{
    transform: Live2DTransform
    centerX: number
    centerY: number
    distance: number
  }>()
  const [retryKey, setRetryKey] = useState(0)
  const [error, setError] = useState<Live2DUserError>()
  const [ready, setReady] = useState(false)

  activityRef.current = activity
  if (activity === 'inactive') hasRetainedInstanceRef.current = false
  speakingRef.current = speaking && !muted && activity === 'active'
  if (recoveryIdentityRef.current.source !== descriptor.source || recoveryIdentityRef.current.quality !== quality) {
    recoveryIdentityRef.current = { source: descriptor.source, quality }
    recoveryModeRef.current = false
    contextRecoveryCountRef.current = 0
  }

  const applyTransform = useCallback((next: Live2DTransform) => {
    const normalized = normalizeLive2DTransform(next)
    transformRef.current = normalized
    const instance = modelRef.current
    if (instance) fitModel(instance, viewportRef.current.width, viewportRef.current.height, normalized)
  }, [])

  useImperativeHandle(ref, () => ({
    perform: async (action) => {
      if (activityRef.current !== 'active' || document.visibilityState === 'hidden') return
      const instance = modelRef.current
      if (!instance) return
      if (action.kind === 'expression' && action.expressionName) {
        await instance.expression(action.expressionName)
      } else if (action.kind === 'motion' && action.motionGroup) {
        const runtime = await ensureCubismRuntime(t)
        await instance.motion(action.motionGroup, action.motionIndex ?? 0, runtime.MotionPriority.FORCE)
      }
    },
    getTransform: () => ({ ...transformRef.current }),
    setTransform: applyTransform,
    resetTransform: () => applyTransform(DEFAULT_LIVE2D_TRANSFORM),
  }))

  useEffect(() => {
    applyTransform(transform ?? DEFAULT_LIVE2D_TRANSFORM)
  }, [applyTransform, transform])

  useEffect(() => {
    if (editMode) return
    pointersRef.current.clear()
    gestureRef.current = undefined
  }, [editMode])

  const beginGesture = useCallback(() => {
    const points = [...pointersRef.current.values()]
    if (points.length === 0) {
      gestureRef.current = undefined
      return
    }
    const first = points[0]
    const second = points[1] ?? first
    gestureRef.current = {
      transform: { ...transformRef.current },
      centerX: (first.x + second.x) / 2,
      centerY: (first.y + second.y) / 2,
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    }
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!editMode || activityRef.current !== 'active') return
      event.preventDefault()
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      event.currentTarget.setPointerCapture(event.pointerId)
      beginGesture()
    },
    [beginGesture, editMode]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!editMode || !pointersRef.current.has(event.pointerId)) return
      event.preventDefault()
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const gesture = gestureRef.current
      const points = [...pointersRef.current.values()]
      if (!gesture || points.length === 0) return
      const first = points[0]
      const second = points[1] ?? first
      const centerX = (first.x + second.x) / 2
      const centerY = (first.y + second.y) / 2
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
      applyTransform({
        offsetX: gesture.transform.offsetX + (centerX - gesture.centerX) / Math.max(1, viewportRef.current.width),
        offsetY: gesture.transform.offsetY + (centerY - gesture.centerY) / Math.max(1, viewportRef.current.height),
        scale: points.length > 1 ? gesture.transform.scale * (distance / gesture.distance) : gesture.transform.scale,
      })
    },
    [applyTransform, editMode]
  )

  const finishPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.delete(event.pointerId)
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId)
      beginGesture()
    },
    [beginGesture]
  )

  useEffect(() => {
    const syncTicker = () => {
      const ticker = appRef.current?.ticker
      if (!ticker) return
      if (activity === 'active' && document.visibilityState !== 'hidden') ticker.start()
      else ticker.stop()
    }

    syncTicker()
    document.addEventListener('visibilitychange', syncTicker)
    return () => document.removeEventListener('visibilitychange', syncTicker)
  }, [activity])

  const renderEnabled = activity === 'active' || (activity === 'preview' && hasRetainedInstanceRef.current)

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey triggers one recovery after a lost WebGL context.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!renderEnabled) {
      setReady(false)
      setError(undefined)
      host.replaceChildren()
      return
    }
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
      const runtime = await ensureCubismRuntime(t)
      if (disposed) return
      const limits = getWebGLLimits()
      const android = isAndroidRuntime()
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      viewportRef.current = { width, height }
      const requestedQuality: Live2DRenderQuality = recoveryModeRef.current ? 'performance' : quality
      let lastFailure: { reason: unknown; phase: Live2DErrorPhase } | undefined

      for (const candidate of getQualityCandidates(requestedQuality)) {
        if (disposed) return
        let app: Application | undefined
        let instance: ModelInstance | undefined
        let instanceAdded = false
        let attemptCleanup: (() => void) | undefined
        let phase: Live2DErrorPhase = 'render'

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
          if (activityRef.current !== 'active' || document.visibilityState === 'hidden') app.ticker.stop()

          let recoveryTimer: number | undefined
          const onContextLost = (event: Event) => {
            event.preventDefault()
            if (disposed) return
            if (recoveryModeRef.current || contextRecoveryCountRef.current > 0) {
              setError(createLive2DError('L2D-CTX-001').diagnostic)
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
          rendererCleanup = attemptCleanup

          phase = 'settings'
          const loadedInstance = await runtime.Live2DModel.from(resolveLive2DAssetUrl(descriptor.source), {
            autoInteract: false,
          })
          phase = 'render'
          instance = loadedInstance
          if (disposed) {
            loadedInstance.destroy()
            if (appRef.current === app) {
              appRef.current = undefined
              app.destroy(true)
            }
            return
          }
          modelRef.current = loadedInstance
          app.stage.addChild(loadedInstance)
          instanceAdded = true
          fitModel(loadedInstance, width, height, transformRef.current)
          if (activityRef.current === 'active') hasRetainedInstanceRef.current = true

          // Models without a LipSync group can still use the standard Cubism mouth parameter.
          app.ticker.add(() => {
            const core = loadedInstance.internalModel.coreModel as {
              setParameterValueById: (id: string, value: number) => void
            }
            const mouth = speakingRef.current ? 0.18 + Math.abs(Math.sin(performance.now() / 82)) * 0.72 : 0
            core.setParameterValueById('ParamMouthOpenY', mouth)
          })
          if (activityRef.current === 'active' && document.visibilityState !== 'hidden') app.ticker.start()
          else app.ticker.stop()

          observer = new ResizeObserver(() => {
            const nextWidth = Math.max(1, host.clientWidth)
            const nextHeight = Math.max(1, host.clientHeight)
            viewportRef.current = { width: nextWidth, height: nextHeight }
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
            fitModel(loadedInstance, nextWidth, nextHeight, transformRef.current)
          })
          observer.observe(host)
          if (!recoveryModeRef.current) contextRecoveryCountRef.current = 0
          setReady(true)
          onReady?.()
          return
        } catch (reason) {
          lastFailure = { reason, phase }
          attemptCleanup?.()
          if (rendererCleanup === attemptCleanup) rendererCleanup = undefined
          observer?.disconnect()
          observer = undefined
          if (disposed) {
            if (instance && !instanceAdded) {
              try {
                instance.destroy()
              } catch {
                // The owning effect already disposed the partial renderer.
              }
            }
            return
          }
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

      const diagnostic = normalizeLive2DError(lastFailure?.reason, {
        phase: lastFailure?.phase || 'render',
        resource: descriptor.builtIn ? descriptor.source : descriptor.name,
      })
      throw new YachiyoLive2DError(diagnostic)
    }

    void initialize().catch((reason) => {
      if (!disposed) {
        setReady(false)
        setError(normalizeLive2DError(reason, { phase: 'render' }))
      }
    })

    return () => {
      disposed = true
      rendererCleanup?.()
      observer?.disconnect()
      disposeResources()
      host.replaceChildren()
    }
  }, [descriptor.source, onReady, quality, renderEnabled, retryKey, t])

  return (
    <div
      className="yachiyo-live2d-stage"
      data-yachiyo-tab-swipe="block"
      data-activity={activity}
      data-ready={renderEnabled && ready && !error ? 'true' : 'false'}
      data-error={error ? 'true' : 'false'}
      data-speaking={speaking && !muted && activity === 'active' ? 'true' : 'false'}
      data-editing={editMode ? 'true' : 'false'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
    >
      <div ref={hostRef} className="yachiyo-live2d-canvas-host" aria-hidden="true" />
      {error && <Live2DErrorPanel error={error} onRetry={() => setRetryKey((value) => value + 1)} />}
    </div>
  )
})
