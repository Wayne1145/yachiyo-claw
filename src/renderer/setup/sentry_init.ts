// Yachiyo Claw intentionally does not initialize an upstream crash reporter.
// Keep the module as a compatibility no-op for integrations that still import it.
import * as Sentry from '@sentry/react'

export default Sentry
