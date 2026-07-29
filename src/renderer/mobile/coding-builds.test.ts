import { describe, expect, it } from 'vitest'
import { artifactPathMatches } from './coding-builds'

describe('coding artifact profile policy', () => {
  it('accepts only declared Capacitor debug APK paths', () => {
    const patterns = ['android/app/build/outputs/apk/debug/*.apk']
    expect(artifactPathMatches('android/app/build/outputs/apk/debug/app-debug.apk', patterns)).toBe(true)
    expect(artifactPathMatches('android/app/build/outputs/apk/release/app-release.apk', patterns)).toBe(false)
    expect(artifactPathMatches('unrelated.apk', patterns)).toBe(false)
  })

  it('supports recursive web artifact patterns', () => {
    expect(artifactPathMatches('dist/assets/index.js', ['dist/**'])).toBe(true)
    expect(artifactPathMatches('outside/index.js', ['dist/**'])).toBe(false)
  })
})
