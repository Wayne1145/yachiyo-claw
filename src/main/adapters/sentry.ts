import type { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'

/**
 * 主进程的 Sentry 适配器实现
 * 使用 @sentry/node 进行错误上报
 */
export class MainSentryAdapter implements SentryAdapter {
  captureException(_error: unknown): void {}

  withScope(callback: (scope: SentryScope) => void): void {
    callback({
      setTag(_key: string, _value: string): void {},
      setExtra(_key: string, _value: unknown): void {},
    })
  }
}

export const sentry = new MainSentryAdapter()
