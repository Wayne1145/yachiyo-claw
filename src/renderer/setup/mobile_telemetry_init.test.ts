import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initJkAnalytics: vi.fn(),
  initSettingsStore: vi.fn().mockResolvedValue({ allowReportingAndTracking: true }),
  initTracking: vi.fn(),
  sentryInit: vi.fn(),
  trackJkViewEvent: vi.fn(),
}))

vi.mock('@/variables', () => ({
  CHATBOX_BUILD_PLATFORM: 'android',
  CHATBOX_BUILD_TARGET: 'mobile_app',
  NODE_ENV: 'test',
}))

vi.mock('@sentry/react', () => ({
  init: mocks.sentryInit,
}))

vi.mock('@/stores/settingsStore', () => ({
  initSettingsStore: mocks.initSettingsStore,
}))

vi.mock('@/platform', () => ({
  default: {
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    initTracking: mocks.initTracking,
    type: 'mobile',
  },
}))

vi.mock('@/hooks/useVersion', () => ({
  isFirstDay: vi.fn(() => false),
}))

vi.mock('@/analytics/jk', () => ({
  initJkAnalytics: mocks.initJkAnalytics,
  trackJkViewEvent: mocks.trackJkViewEvent,
}))

vi.mock('@/analytics/jk-events', () => ({
  JK_EVENTS: { APP_LAUNCH: 'app_launch' },
}))

describe('mobile telemetry initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('does not initialize Sentry, GA, Plausible, or JK analytics', async () => {
    await Promise.all([
      import('./sentry_init'),
      import('./ga_init'),
      import('./plausible_init'),
      import('./jk_analytics_init'),
    ])

    expect(mocks.initSettingsStore).not.toHaveBeenCalled()
    expect(mocks.sentryInit).not.toHaveBeenCalled()
    expect(mocks.initTracking).not.toHaveBeenCalled()
    expect(mocks.initJkAnalytics).not.toHaveBeenCalled()
    expect(mocks.trackJkViewEvent).not.toHaveBeenCalled()
  })
})
