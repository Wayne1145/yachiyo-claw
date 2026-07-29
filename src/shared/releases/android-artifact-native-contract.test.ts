import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const plugin = readFileSync(
  'android/app/src/main/java/io/github/yachiyoclaw/artifact/YachiyoArtifactPlugin.java',
  'utf8'
)
const activity = readFileSync('android/app/src/main/java/io/github/yachiyoclaw/MainActivity.java', 'utf8')

describe('Android workspace artifact installer contract', () => {
  it('registers a dedicated plugin and preserves system installer confirmation', () => {
    expect(activity).toContain('registerPlugin(YachiyoArtifactPlugin.class)')
    expect(plugin).toContain('@CapacitorPlugin(name = "YachiyoArtifact")')
    expect(plugin).toContain('new Intent(Intent.ACTION_VIEW)')
    expect(plugin).toContain('FileProvider.getUriForFile')
  })

  it('bounds APKs, blocks the host package, and verifies the approved digest again', () => {
    expect(plugin).toContain('MAX_APK_BYTES = 512L * 1024L * 1024L')
    expect(plugin).toContain('artifact_host_package_blocked')
    expect(plugin).toContain('artifact_digest_mismatch')
    expect(plugin).toContain('PackageManager.GET_SIGNING_CERTIFICATES')
  })
})
