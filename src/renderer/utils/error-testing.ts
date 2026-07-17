import * as Sentry from '@sentry/react'
import { getLogger } from '../lib/utils'

const log = getLogger('ErrorTesting')

// Development utility functions for testing error handling
export const errorTestingUtils = {
  // Test React error boundary
  triggerReactError: () => {
    throw new Error('Test React error boundary - this error is intentional for testing')
  },

  // Test global error handler
  triggerGlobalError: () => {
    setTimeout(() => {
      throw new Error('Test global error handler - this error is intentional for testing')
    }, 100)
  },

  // Test unhandled promise rejection
  triggerUnhandledRejection: () => {
    Promise.reject(new Error('Test unhandled promise rejection - this error is intentional for testing'))
  },

  // Test cannot read properties error
  triggerPropertyError: () => {
    try {
      const obj: any = null
      return obj.nonExistentProperty.anotherProperty
    } catch (e) {
      throw e
    }
  },

  // Test Sentry directly
  testSentryCapture: () => {
    Sentry.captureMessage('Test Sentry message capture - this is intentional for testing', 'info')
    Sentry.captureException(new Error('Test Sentry exception capture - this is intentional for testing'))
    log.info('Sentry test messages sent')
  },

  // Test console error interception
  triggerConsoleError: () => {
    console.error('Test console error interception: cannot read properties of undefined')
  },
}

// Make it available globally in development
if (process.env.NODE_ENV === 'development') {
  ;(window as any).errorTestingUtils = errorTestingUtils
  log.info('Error testing utilities available at window.errorTestingUtils')
}
