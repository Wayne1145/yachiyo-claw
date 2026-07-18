import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultAllowReportingAndTracking } from '@shared/defaults'
import { describe, expect, it } from 'vitest'
import {
  shouldInitializeUpstreamTelemetry,
  shouldUploadSentryArtifacts,
  stripUpstreamTelemetryHtml,
} from './telemetry_policy'

describe('Yachiyo telemetry policy', () => {
  it('disables upstream runtime reporting and Sentry uploads on every build', () => {
    expect(defaultAllowReportingAndTracking('mobile_app')).toBe(false)
    expect(shouldInitializeUpstreamTelemetry('mobile_app')).toBe(false)
    expect(shouldUploadSentryArtifacts('sentry-token', true)).toBe(false)
    expect(defaultAllowReportingAndTracking('desktop')).toBe(false)
    expect(shouldInitializeUpstreamTelemetry('desktop')).toBe(false)
    expect(shouldUploadSentryArtifacts('sentry-token', false)).toBe(false)
    expect(shouldUploadSentryArtifacts(undefined, false)).toBe(false)
  })

  it('removes the complete upstream telemetry block from the renderer template', () => {
    const html = readFileSync(resolve(process.cwd(), 'src/renderer/index.html'), 'utf8')
    const stripped = stripUpstreamTelemetryHtml(html)

    expect(stripped).not.toContain('www.googletagmanager.com')
    expect(stripped).not.toContain('plausible.midway.run')
    expect(stripped).not.toContain('window.plausible')
    expect(stripped).not.toContain('function gtag()')
    expect(stripped).toContain('initial-theme')
  })

  it('fails closed if an unmarked upstream telemetry script remains', () => {
    expect(() => stripUpstreamTelemetryHtml('<script src="https://plausible.midway.run/script.js"></script>')).toThrow(
      'Mobile build still contains an upstream telemetry script'
    )
  })
})
