declare global {
  interface Window {
    plausible?: ((event: string, options?: { props?: Record<string, unknown> }) => void) & { q?: unknown[] }
  }
}

export function trackEvent(event: string, props: Record<string, unknown> = {}) {
  if (window.plausible) {
    window.plausible(event, { props })
  }
}
