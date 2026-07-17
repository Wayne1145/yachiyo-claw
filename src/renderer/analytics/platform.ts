export function mapPlatformToTrackingPlatform(platformName: string): 'app' | 'web' | 'mobile' {
  if (platformName === 'web') {
    return 'web'
  }

  if (platformName === 'ios' || platformName === 'android') {
    return 'mobile'
  }

  return 'app'
}
