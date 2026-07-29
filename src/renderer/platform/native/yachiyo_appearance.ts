import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export type AndroidAppearanceScheme = 'light' | 'dark'
export type AndroidNavigationMode = 'gesture' | 'three-button' | 'unknown' | 'not-android'

export interface AndroidSystemGestureInsetsCssPx {
  left: number
  right: number
}

export interface AndroidInteractionState {
  navigationMode: AndroidNavigationMode
  systemGestureInsetsCssPx: AndroidSystemGestureInsetsCssPx
  touchExplorationEnabled: boolean
}

export interface AndroidSystemBarOptions {
  scheme: AndroidAppearanceScheme
  /** CSS #RRGGBB or #RRGGBBAA color used only when navigation buttons need contrast. */
  navigationBarColor?: string
}

export interface AndroidSystemBarResult extends AndroidInteractionState {
  applied: boolean
  edgeToEdge: boolean
}

type NativeAndroidInteractionState = Omit<AndroidInteractionState, 'navigationMode'> & {
  navigationMode: Exclude<AndroidNavigationMode, 'not-android'>
}

interface YachiyoAppearancePlugin {
  setSystemBars(options: Required<AndroidSystemBarOptions>): Promise<
    NativeAndroidInteractionState & {
      applied: true
      edgeToEdge: true
    }
  >
  getInteractionState(): Promise<NativeAndroidInteractionState>
  addListener(
    eventName: 'interactionStateChanged',
    listener: (state: NativeAndroidInteractionState) => void,
  ): Promise<PluginListenerHandle>
}

const DEFAULT_NAVIGATION_COLORS: Record<AndroidAppearanceScheme, string> = {
  light: '#F7F9FCF2',
  dark: '#15191FF2',
}

const yachiyoAppearanceNative = registerPlugin<YachiyoAppearancePlugin>('YachiyoAppearance')

const NOT_ANDROID_INTERACTION_STATE: AndroidInteractionState = {
  navigationMode: 'not-android',
  systemGestureInsetsCssPx: { left: 0, right: 0 },
  touchExplorationEnabled: false,
}

function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function syncAndroidSystemBars(options: AndroidSystemBarOptions): Promise<AndroidSystemBarResult> {
  if (!isNativeAndroid()) {
    return { applied: false, edgeToEdge: false, ...NOT_ANDROID_INTERACTION_STATE }
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

export async function getAndroidInteractionState(): Promise<AndroidInteractionState> {
  if (!isNativeAndroid()) return NOT_ANDROID_INTERACTION_STATE
  return yachiyoAppearanceNative.getInteractionState()
}

export async function onAndroidInteractionStateChanged(
  listener: (state: AndroidInteractionState) => void,
): Promise<PluginListenerHandle> {
  if (!isNativeAndroid()) return { remove: async () => undefined }
  return yachiyoAppearanceNative.addListener('interactionStateChanged', listener)
}
