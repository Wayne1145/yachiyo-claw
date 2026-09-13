import { AppLauncher } from '@capacitor/app-launcher'
import { toast } from 'sonner'
import { getLogger } from '@/lib/utils'

const log = getLogger('continuous-corners')

export const CONTINUOUS_CORNERS_DISMISSED_STORAGE_KEY = 'yachiyo:appearance:continuous-corners-notice-dismissed:v1'
export const MIN_WEBVIEW_MAJOR_FOR_CONTINUOUS_CORNERS = 139
export const ANDROID_WEBVIEW_PLAY_STORE_URL = 'market://details?id=com.google.android.webview'
const WEBVIEW_NOTICE_TOAST_ID = 'yachiyo-webview-outdated'

export function supportsContinuousCorners(): boolean {
  return (
    typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('corner-shape', 'squircle')
  )
}

export function getAndroidWebViewMajorVersion(userAgent?: string): number | undefined {
  const ua = userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent)
  if (!/Android/i.test(ua)) return undefined
  const match = ua.match(/Chrome\/(\d+)/i)
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined
}

export interface ContinuousCornersNoticeDecision {
  supported: boolean
  webViewMajorVersion?: number
  shouldNotify: boolean
}

export function resolveContinuousCornersNotice(options: {
  supported?: boolean
  userAgent?: string
  dismissed?: boolean
}): ContinuousCornersNoticeDecision {
  const supported = options.supported ?? supportsContinuousCorners()
  if (supported) return { supported, shouldNotify: false }
  const webViewMajorVersion = getAndroidWebViewMajorVersion(options.userAgent)
  if (webViewMajorVersion === undefined) return { supported, shouldNotify: false }
  if (webViewMajorVersion >= MIN_WEBVIEW_MAJOR_FOR_CONTINUOUS_CORNERS) {
    return { supported, webViewMajorVersion, shouldNotify: false }
  }
  return { supported, webViewMajorVersion, shouldNotify: options.dismissed !== true }
}

function isNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(CONTINUOUS_CORNERS_DISMISSED_STORAGE_KEY) === 'dismissed'
  } catch {
    return false
  }
}

function dismissNotice(): void {
  try {
    localStorage.setItem(CONTINUOUS_CORNERS_DISMISSED_STORAGE_KEY, 'dismissed')
  } catch {
    // Storage is optional; the toast itself still works for this session.
  }
}

export function applyContinuousCornersCapability(): boolean {
  const supported = supportsContinuousCorners()
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.yachiyoCorners = supported ? 'squircle' : 'round'
  }
  return supported
}

export function maybeNotifyOutdatedWebView(translate: (key: string) => string): boolean {
  const decision = resolveContinuousCornersNotice({ dismissed: isNoticeDismissed() })
  if (!decision.shouldNotify) return false

  log.info(`WebView ${decision.webViewMajorVersion} lacks corner-shape support; prompting for an update`)
  const openPlayStore = () => {
    dismissNotice()
    void AppLauncher.openUrl({ url: ANDROID_WEBVIEW_PLAY_STORE_URL }).catch((error) => {
      log.warn('failed to open the Play Store WebView page', error)
    })
  }
  toast(translate('系统 WebView 版本过旧，连续圆角与部分视觉效果已切换为兼容模式。'), {
    id: WEBVIEW_NOTICE_TOAST_ID,
    description: translate('更新 Android System WebView 后即可恢复完整效果。'),
    duration: 12000,
    action: { label: translate('更新 WebView'), onClick: openPlayStore },
    onDismiss: dismissNotice,
    onAutoClose: dismissNotice,
  })
  return true
}
