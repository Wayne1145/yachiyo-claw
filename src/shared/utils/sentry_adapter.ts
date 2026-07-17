/**
 * 跨平台 Sentry 适配器接口
 * 允许在不同环境中使用统一的错误上报 API
 */
export interface SentryAdapter {
  captureException(error: unknown): void
  withScope(callback: (scope: SentryScope) => void): void
}

export interface SentryScope {
  setTag(key: string, value: string): void
  setExtra(key: string, value: unknown): void
}
