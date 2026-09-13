import { describe, expect, it } from 'vitest'
import {
  getAndroidWebViewMajorVersion,
  MIN_WEBVIEW_MAJOR_FOR_CONTINUOUS_CORNERS,
  resolveContinuousCornersNotice,
} from './continuous-corners'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP31.240617.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.219 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('getAndroidWebViewMajorVersion', () => {
  it('parses the Chrome major version from an Android WebView user agent', () => {
    expect(getAndroidWebViewMajorVersion(ANDROID_UA)).toBe(124)
  })

  it('returns undefined for non-Android user agents', () => {
    expect(getAndroidWebViewMajorVersion(DESKTOP_UA)).toBeUndefined()
  })

  it('returns undefined when the Android user agent has no Chrome token', () => {
    expect(getAndroidWebViewMajorVersion('Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36')).toBeUndefined()
  })
})

describe('resolveContinuousCornersNotice', () => {
  it('never notifies when the engine supports corner-shape', () => {
    expect(resolveContinuousCornersNotice({ supported: true, userAgent: ANDROID_UA }).shouldNotify).toBe(false)
  })

  it('notifies on Android WebViews older than the corner-shape baseline', () => {
    const decision = resolveContinuousCornersNotice({ supported: false, userAgent: ANDROID_UA })
    expect(decision.shouldNotify).toBe(true)
    expect(decision.webViewMajorVersion).toBe(124)
  })

  it('does not notify once the WebView meets the baseline', () => {
    const ua = ANDROID_UA.replace('Chrome/124', `Chrome/${MIN_WEBVIEW_MAJOR_FOR_CONTINUOUS_CORNERS}`)
    expect(resolveContinuousCornersNotice({ supported: false, userAgent: ua }).shouldNotify).toBe(false)
  })

  it('does not notify outside Android', () => {
    expect(resolveContinuousCornersNotice({ supported: false, userAgent: DESKTOP_UA }).shouldNotify).toBe(false)
  })

  it('respects a dismissed notice', () => {
    expect(resolveContinuousCornersNotice({ supported: false, userAgent: ANDROID_UA, dismissed: true }).shouldNotify).toBe(
      false
    )
  })
})
