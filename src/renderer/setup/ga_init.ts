import platforms from '@/platform'
import { CHATBOX_BUILD_TARGET } from '@/variables'
import { shouldInitializeUpstreamTelemetry } from './telemetry_policy'

if (shouldInitializeUpstreamTelemetry(CHATBOX_BUILD_TARGET)) {
  try {
    platforms.initTracking()
  } catch (e) {
    console.error(e)
  }
}
