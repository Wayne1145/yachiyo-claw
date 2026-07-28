import { Capacitor, registerPlugin } from '@capacitor/core'

export type AndroidAppearanceScheme = 'light' | 'dark'
export type AndroidNavigationMode = 'gesture' | 'three-button' | 'unknown' | 'not-android'

export interface AndroidSystemBarOptions {
  scheme: AndroidAppearanceScheme
  /** CSS #RRGGBB or #RRGGBBAA color used only when navigation buttons need contrast. */
  navigationBarColor?: string
}

export interface AndroidSystemBarResult {
  applied: boolean
  edgeToEdge: boolean
  navigationMode: AndroidNavigationMode
}

interface YachiyoAppearancePlugin {
  setSystemBars(options: Required<AndroidSystemBarOptions>): Promise<{
    applied: true
    edgeToEdge: true
    navigationMode: Exclude<AndroidNavigationMode, 'not-android'>
  }>
}

const DEFAULT_NAVIGATION_COLORS: Record<AndroidAppearanceScheme, string> = {
  light: '#F7F9FCF2',
  dark: '#15191FF2',
}

const yachiyoAppearanceNative = registerPlugin<YachiyoAppearancePlugin>('YachiyoAppearance')

export async function syncAndroidSystemBars(options: AndroidSystemBarOptions): Promise<AndroidSystemBarResult> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return { applied: false, edgeToEdge: false, navigationMode: 'not-android' }
  }

  const navigationBarColor = options.navigationBarColor ?? DEFAULT_NAVIGATION_COLORS[options.scheme]
  if (!/^#[\da-f]{6}([\da-f]{2})?$/i.test(navigationBarColor)) {
    throw new TypeError('navigationBarColor must use CSS #RRGGBB or #RRGGBBAA syntax')
  }
  return yachiyoAppearanceNative.setSystemBars({
    scheme: options.scheme,
    navigationBarColor,
  })
}
