import { readFileSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })

describe('Android in-app update native contract', () => {
  it('declares package installation permission and a private FileProvider', () => {
    const manifest = parser.parse(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')).manifest
    const permissions = Array.isArray(manifest['uses-permission'])
      ? manifest['uses-permission']
      : [manifest['uses-permission']]
    expect(permissions.map((permission: { 'android:name': string }) => permission['android:name'])).toContain(
      'android.permission.REQUEST_INSTALL_PACKAGES'
    )

    const providers = Array.isArray(manifest.application.provider)
      ? manifest.application.provider
      : [manifest.application.provider]
    const fileProvider = providers.find(
      (provider: { 'android:name': string }) => provider['android:name'] === 'androidx.core.content.FileProvider'
    )
    expect(fileProvider).toMatchObject({
      'android:authorities': '$' + '{applicationId}.fileprovider',
      'android:exported': 'false',
      'android:grantUriPermissions': 'true',
    })
    expect(fileProvider['meta-data']).toMatchObject({
      'android:name': 'android.support.FILE_PROVIDER_PATHS',
      'android:resource': '@xml/file_paths',
    })
  })

  it('exposes only dedicated update, workspace-export, and inspected-artifact cache directories', () => {
    const paths = parser.parse(readFileSync('android/app/src/main/res/xml/file_paths.xml', 'utf8')).paths
    const cachePaths = Array.isArray(paths['cache-path']) ? paths['cache-path'] : [paths['cache-path']]
    expect(cachePaths).toEqual([
      { name: 'verified_updates', path: 'verified-updates/' },
      { name: 'workspace_exports', path: 'workspace-exports/' },
      { name: 'workspace_artifacts', path: 'workspace-artifacts/' },
    ])
    expect(JSON.stringify(paths)).not.toContain('path":"."')
  })

  it('registers the updater and delegates installation to Android PackageManager', () => {
    const activity = readFileSync('android/app/src/main/java/io/github/yachiyoclaw/MainActivity.java', 'utf8')
    const plugin = readFileSync(
      'android/app/src/main/java/io/github/yachiyoclaw/update/YachiyoUpdatePlugin.java',
      'utf8'
    )
    const verifier = readFileSync(
      'android/app/src/main/java/io/github/yachiyoclaw/update/UpdatePackageVerifier.java',
      'utf8'
    )
    expect(activity).toContain('registerPlugin(YachiyoUpdatePlugin.class)')
    expect(plugin).toContain('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES')
    expect(plugin).toContain('new Intent(Intent.ACTION_VIEW)')
    expect(plugin).toContain('FileProvider.getUriForFile')
    expect(plugin).toContain('UpdatePackageVerifier.requireTrusted')
    expect(verifier).toContain('PackageManager.GET_SIGNING_CERTIFICATES')
  })

  it('allows WorkManager to run model downloads as data-sync foreground work', () => {
    const manifest = parser.parse(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')).manifest
    const services = Array.isArray(manifest.application.service)
      ? manifest.application.service
      : [manifest.application.service]
    const workManagerService = services.find(
      (service: { 'android:name': string }) =>
        service['android:name'] === 'androidx.work.impl.foreground.SystemForegroundService'
    )
    const notification = readFileSync(
      'android/app/src/main/java/io/github/yachiyoclaw/model/YachiyoModelNotification.java',
      'utf8'
    )

    expect(workManagerService['android:foregroundServiceType'].split('|')).toContain('dataSync')
    expect(notification).toContain('ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC')
  })
})
