import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'

export function trackingEvent(name: string, params: { [key: string]: string } = {}) {
  const allowReportingAndTracking = settingsStore.getState().allowReportingAndTracking
  if (!allowReportingAndTracking) {
    return
  }
  platform.trackingEvent(name, params)
}
