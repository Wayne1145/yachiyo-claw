import * as Sentry from '@sentry/react'
import { getLogger } from '../lib/utils'

const log = getLogger('GlobalErrorHandler')

// Global error handler for unhandled errors
window.addEventListener('error', (event) => {
  log.error('Global error caught:', event.error)

  Sentry.withScope((scope) => {
    scope.setTag('errorType', 'global')
    scope.setLevel('error')
    scope.setContext('errorEvent', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      source: event.error?.stack || 'No stack trace available',
    })
    Sentry.captureException(event.error || new Error(event.message))
  })
})

// Global handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  log.error('Unhandled promise rejection:', event.reason)

  Sentry.withScope((scope) => {
    scope.setTag('errorType', 'unhandledRejection')
    scope.setLevel('error')
    scope.setContext('promiseRejection', {
      reason: event.reason,
      promise: event.promise?.toString() || 'Unknown promise',
    })

    const error =
      event.reason instanceof Error ? event.reason : new Error(`Unhandled promise rejection: ${event.reason}`)

    Sentry.captureException(error)
  })

  // Prevent the default behavior (console error)
  // event.preventDefault()
})

// Console error interceptor (optional, for additional logging)
const originalConsoleError = console.error
const reportedErrors = new WeakSet()
const reportedMessages = new Set<string>()

console.error = (...args: unknown[]) => {
  // Still call the original console.error
  originalConsoleError.apply(console, args)

  // Early exit for non-error cases
  if (args.length === 0) return

  // Check if any argument is an actual Error object
  const errorObjects = args.filter((arg) => arg instanceof Error)

  // If we have Error objects, use them for detection
  if (errorObjects.length > 0) {
    for (const error of errorObjects) {
      // Avoid duplicate reporting
      if (reportedErrors.has(error)) continue

      // Check if this is a genuine error type we care about
      if (
        error instanceof TypeError ||
        error instanceof ReferenceError ||
        error instanceof RangeError ||
        error instanceof EvalError ||
        error instanceof URIError
      ) {
        reportedErrors.add(error)

        log.error('Console error that might be uncaught:', error)

        Sentry.withScope((scope) => {
          scope.setTag('errorType', 'console')
          scope.setLevel('warning')
          scope.setContext('consoleError', {
            name: error.name,
            message: error.message,
            stack: error.stack,
          })
          Sentry.captureException(error)
        })
      }
    }
    return
  }

  // Fallback to string analysis for non-Error objects
  const errorMessage = args.join(' ')

  // Create a simple hash for duplicate detection
  const messageHash = errorMessage.substring(0, 100)
  if (reportedMessages.has(messageHash)) return

  // Only check string patterns if no Error objects were found
  if (
    errorMessage.includes('cannot read properties of undefined') ||
    errorMessage.includes('Cannot read property') ||
    errorMessage.includes('TypeError:') ||
    errorMessage.includes('ReferenceError:')
  ) {
    reportedMessages.add(messageHash)

    log.error('Console error that might be uncaught:', errorMessage)

    Sentry.withScope((scope) => {
      scope.setTag('errorType', 'console')
      scope.setLevel('warning')
      scope.setContext('consoleError', {
        message: errorMessage,
        args: args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))),
      })
      Sentry.captureMessage(errorMessage, 'warning')
    })
  }
}

log.info('Global error handlers initialized')
