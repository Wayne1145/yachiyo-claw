const UPSTREAM_TELEMETRY_START = '<!-- upstream-telemetry:start -->'
const UPSTREAM_TELEMETRY_END = '<!-- upstream-telemetry:end -->'

export function shouldInitializeUpstreamTelemetry(_buildTarget: string): boolean {
  return false
}

export function shouldUploadSentryArtifacts(_authToken: string | undefined, _isMobile: boolean): boolean {
  return false
}

export function stripUpstreamTelemetryHtml(html: string): string {
  const start = html.indexOf(UPSTREAM_TELEMETRY_START)
  const end = html.indexOf(UPSTREAM_TELEMETRY_END)

  let stripped = html
  if (start !== -1 && end !== -1 && end > start) {
    stripped = `${html.slice(0, start)}${html.slice(end + UPSTREAM_TELEMETRY_END.length)}`
  }

  if (/googletagmanager\.com|plausible\.midway\.run/i.test(stripped)) {
    throw new Error('Mobile build still contains an upstream telemetry script')
  }

  return stripped
}
