// 这个库解决了移动端异形屏的显示安全区域的问题，比如iPhoneX，iPhone11等
// 这个库引入后，将设置全局的css变量 --mobile-safe-area-inset-top, --mobile-safe-area-inset-bottom, --mobile-safe-area-inset-left, --mobile-safe-area-inset-right
// 通过这些变量，可以在css中设置安全区域的padding，margin等，来规避异形屏的显示问题
// 为了达到最好的效果，在 html 的 meta 标签中设置 viewport-fit=cover

import { Keyboard } from '@capacitor/keyboard'
import { SafeArea } from 'capacitor-plugin-safe-area'

interface MobileSafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

let keyboardOpen = false
let refreshGeneration = 0
let resizeFrame: number | undefined

function applySafeAreaInsets(insets: MobileSafeAreaInsets) {
  for (const [key, value] of Object.entries(insets)) {
    document.documentElement.style.setProperty(
      `--mobile-safe-area-inset-${key}`,
      `${key === 'bottom' && keyboardOpen ? 0 : value}px`
    )
  }
}

async function refreshSafeAreaInsets() {
  const generation = ++refreshGeneration
  try {
    const { insets } = await SafeArea.getSafeAreaInsets()
    if (generation === refreshGeneration) applySafeAreaInsets(insets)
  } catch {
    console.warn('Unable to read mobile safe-area insets')
  }
}

void refreshSafeAreaInsets()

void SafeArea.addListener('safeAreaChanged', () => {
  // A queued native event can still contain the previous orientation's insets.
  void refreshSafeAreaInsets()
}).catch(() => console.warn('Unable to observe mobile safe-area changes'))

const scheduleRefresh = () => {
  if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame)
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = undefined
    void refreshSafeAreaInsets()
  })
}
window.addEventListener('resize', scheduleRefresh)
window.addEventListener('orientationchange', scheduleRefresh)

void Keyboard.addListener('keyboardWillShow', () => {
  keyboardOpen = true
  document.documentElement.dataset.yachiyoKeyboard = 'open'
  document.documentElement.style.setProperty(`--mobile-safe-area-inset-bottom`, `0px`)
  void refreshSafeAreaInsets()
}).catch(() => console.warn('Unable to observe the mobile keyboard'))

void Keyboard.addListener('keyboardWillHide', () => {
  keyboardOpen = false
  delete document.documentElement.dataset.yachiyoKeyboard
  void refreshSafeAreaInsets()
}).catch(() => console.warn('Unable to observe the mobile keyboard'))
