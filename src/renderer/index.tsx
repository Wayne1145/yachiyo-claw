import { SplashScreen } from '@capacitor/splash-screen'
import '@mantine/core/styles.css'
import '@mantine/spotlight/styles.css'
import * as Sentry from '@sentry/react'
import { RouterProvider } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import 'photoswipe/dist/photoswipe.css'
import { StrictMode, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { ProtectedSettingsRecovery } from './components/common/ProtectedSettingsRecovery'
import i18n from './i18n'
import { getLogger } from './lib/utils'
import { shouldUseAndroidAppShell } from './mobile/android-app-shell'
import platform from './platform'
import { isProtectedMobileSettingsError } from './platform/storages'
import reportWebVitals from './reportWebVitals'
import { router } from './router'
import './static/globals.css'
import './static/index.css'
import { StorageKey } from './storage'
import { initLogAtom, migrationProcessAtom } from './stores/atoms/utilAtoms'
import { initAuthInfoStore } from './stores/authInfoStore'
import * as migration from './stores/migration'
import queryClient from './stores/queryClient'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from './variables'

const log = getLogger('index')

// 按需加载 polyfill
import './setup/load_polyfill'

// Sentry 初始化
import './setup/sentry_init'

// 全局错误处理
import './setup/global_error_handler'

// GA4 初始化
import './setup/ga_init'

// Plausible 初始化
import './setup/plausible_init'

// jk analytics 初始化
import './setup/jk_analytics_init'

// 引入保护代码
import './setup/protect'
import { QueryClientProvider } from '@tanstack/react-query'
import { initSessionAttachmentRagMaintenance } from './setup/session_attachment_rag_maintenance'
import { initLastUsedModelStore } from './stores/lastUsedModelStore'
import { initOnboardingStore } from './stores/onboardingStore'
import { initLoginLicenseStateReconciliation } from './stores/premiumActions'
import { initRecentDirectoriesStore } from './stores/recentDirectoriesStore'
import { initSettingsStore } from './stores/settingsStore'
import { initUpdateListeners } from './stores/updateStore'

// 开发环境下引入错误测试工具
// if (process.env.NODE_ENV === 'development') {
//   import('./utils/error-testing')
// }

// Token estimation system initialization (runs in all environments)
void import('./setup/token_estimation_init')

// 引入移动端安全区域代码，主要为了解决异形屏幕的问题
if (CHATBOX_BUILD_TARGET === 'mobile_app') {
  void import('./setup/mobile_safe_area')
}

// ==========执行初始化==============
async function initializeApp() {
  log.info('initializeApp')

  try {
    // 数据迁移
    await migration.migrate()
    log.info('migrate done')
  } catch (e) {
    if (platform.type === 'mobile' && isProtectedMobileSettingsError(e)) {
      throw e
    }
    log.error('migrate error', e)
    Sentry.captureException(e as Error)
  }

  // 最后执行 storage 清理，清理不 block 进入UI
  void import('./setup/storage_clear')

  // 启动mcp服务器
  void import('./setup/mcp_bootstrap')
}

// ==========渲染节点==============

function InitPage() {
  const log = useAtomValue(initLogAtom)
  const [showLoadingLog, setShowLoadingLog] = useState(false)
  const migrationProcess = useAtomValue(migrationProcessAtom)

  return (
    <div className="flex flex-col items-center absolute top-0 left-0 w-full h-full">
      <p className="font-roboto font-normal opacity-40 mt-4 mb-2">
        {migrationProcess ? `Migrating...(${migrationProcess})` : 'loading...'}
      </p>
      <div className="">
        <div
          role="button"
          tabIndex={0}
          className="px-4 py-0 rounded-md cursor-pointer select-none text-sm text-blue-600"
          onClick={() => setShowLoadingLog(!showLoadingLog)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setShowLoadingLog(!showLoadingLog)
              e.preventDefault()
            }
          }}
        >
          {showLoadingLog ? 'Hide Loading Log' : 'Show Loading Log'}
        </div>
      </div>
      {/* 倒叙展示，能够看到最新的日志 */}
      {showLoadingLog && (
        <pre className="whitespace-pre-wrap flex-1 overflow-y-auto m-0 p-2">{[...log].reverse().join('\n')}</pre>
      )}
    </div>
  )
}

// initializeApp执行时间少于1s的话，将不会看到log
const appRoot = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
let loadingRoot: ReturnType<typeof ReactDOM.createRoot> | undefined
const tid = setTimeout(() => {
  loadingRoot = ReactDOM.createRoot(document.getElementById('log-root') as HTMLElement)
  loadingRoot.render(
    <StrictMode>
      <ErrorBoundary>
        <InitPage />
      </ErrorBoundary>
    </StrictMode>
  )
  if (platform.type === 'mobile') {
    void SplashScreen.hide()
  }
}, 1000)

function stopLoadingPage() {
  clearTimeout(tid)
  loadingRoot?.unmount()
  loadingRoot = undefined
}

function hideSplashScreen(immediately = false) {
  if (platform.type === 'mobile') {
    void SplashScreen.hide()
  }

  const element = document.querySelector('.splash-screen')
  if (!element) return
  if (immediately) {
    element.remove()
    return
  }

  element.addEventListener('animationend', () => element.remove(), { once: true })
  element.classList.add('splash-screen-fade-out')
}

async function resetProtectedMobileSettings() {
  // Recovery is intentionally scoped to one row; chats and all other local data remain untouched.
  await platform.delStoreValue(StorageKey.Settings)
  window.location.reload()
}

function renderProtectedSettingsRecovery() {
  stopLoadingPage()
  appRoot.render(
    <StrictMode>
      <ProtectedSettingsRecovery onReset={resetProtectedMobileSettings} />
    </StrictMode>
  )
  hideSplashScreen(true)
}

async function startApp() {
  // Probe before Zustand hydration, which does not expose storage failures to its completion listener.
  if (platform.type === 'mobile') {
    await platform.getStoreValue(StorageKey.Settings)
  }

  await initializeApp()
  stopLoadingPage()

  // 等待settings和onboarding初始化完成，避免闪屏
  const [settings] = await Promise.all([
    initSettingsStore(),
    initAuthInfoStore(),
    initLastUsedModelStore(),
    initOnboardingStore(),
    initRecentDirectoriesStore(),
  ])

  await i18n.changeLanguage(settings.language)
  if (!shouldUseAndroidAppShell(platform.type, CHATBOX_BUILD_PLATFORM)) {
    initLoginLicenseStateReconciliation()
  }

  // Initialize auto-updater event listeners (desktop only, idempotent)
  if (platform.type === 'desktop') {
    initUpdateListeners()
    initSessionAttachmentRagMaintenance()
  }
  // Cleanup is intentionally not captured — listeners persist for the app lifetime

  // 初始化完成，可以开始渲染
  appRoot.render(
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>
  )

  hideSplashScreen()

  if (window.navigator.storage) {
    void navigator.storage.persisted().then((persisted) => {
      if (!persisted) {
        void navigator.storage.persist()
      }
    })
  }
}

void startApp().catch((error: unknown) => {
  if (platform.type === 'mobile' && isProtectedMobileSettingsError(error)) {
    renderProtectedSettingsRecovery()
    return
  }

  // Preserve the existing generic startup-error path for desktop and unrelated mobile failures.
  Sentry.captureException(error)
  log.error('initializeApp error', error)
})

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
