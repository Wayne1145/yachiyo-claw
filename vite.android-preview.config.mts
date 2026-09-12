/**
 * Renderer-only dev server for previewing the Android shell in a desktop browser.
 *
 *   pnpm exec cross-env CHATBOX_BUILD_TARGET=mobile_app CHATBOX_BUILD_PLATFORM=android \
 *     vite --config vite.android-preview.config.mts --port 1212
 *
 * `electron-vite dev --rendererOnly` still insists on launching Electron, so this reuses the
 * renderer section of electron.vite.config.ts directly. Native Capacitor plugins are absent in a
 * browser; the shell degrades to its web fallbacks, which is enough for theme and layout work.
 */
import electronViteConfig from './electron.vite.config'

export default async () => {
  const resolved =
    typeof electronViteConfig === 'function'
      ? await electronViteConfig({ mode: 'development', command: 'serve', isSsrBuild: false, isPreview: false })
      : electronViteConfig
  const renderer = (resolved as { renderer?: Record<string, unknown> }).renderer ?? {}
  return { ...renderer, root: 'src/renderer' }
}
