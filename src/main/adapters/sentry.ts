import * as Sentry from '@sentry/node'
import { app } from 'electron'
import type { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'
import { getSettings } from '../store-node'

function initSentry() {
  const settings = getSettings()
  if (!settings.allowReportingAndTracking) {
    return
  }

  const version = app.getVersion()
  Sentry.init({
    dsn: 'https://eca691c5e01ebfa05958fca1fcb487a9@sentry.midway.run/697',
    integrations: [],
    environment: process.env.NODE_ENV || 'development',
    // Performance Monitoring - set to 1.0 since we control sampling in beforeSend
    sampleRate: 1.0,
    tracesSampler(samplingContext) {
      // For traces related to knowledge-base operations, always sample
      const isKnowledgeBaseTrace =
        samplingContext.tags?.component === 'knowledge-base-file' ||
        samplingContext.tags?.component === 'knowledge-base-db' ||
        samplingContext.tags?.component === 'knowledge-base'

      if (isKnowledgeBaseTrace) {
        return 1.0 // 100% sampling for knowledge-base traces
      }

      return 0.1 // 10% sampling for other traces
    },
    release: version,
    // 设置全局标签
    initialScope: {
      tags: {
        platform: 'desktop',
        app_version: version,
      },
    },
  })
}

initSentry()

/**
 * 主进程的 Sentry 适配器实现
 * 使用 @sentry/node 进行错误上报
 */
export class MainSentryAdapter implements SentryAdapter {
  captureException(error: unknown): void {
    Sentry.captureException(error)
  }

  withScope(callback: (scope: SentryScope) => void): void {
    Sentry.withScope((sentryScope) => {
      const scope: SentryScope = {
        setTag(key: string, value: string): void {
          sentryScope.setTag(key, value)
        },
        setExtra(key: string, value: unknown): void {
          sentryScope.setExtra(key, value)
        },
      }
      callback(scope)
    })
  }
}

export const sentry = new MainSentryAdapter()
