import { describe, expect, it } from 'vitest'
import { BUILD_TARGET_PROFILES, CodingProjectRecordSchema, findRemoteBuildProvider, getBuildTargetProfile } from './coding'

describe('mobile coding target profiles', () => {
  it('never represents desktop and Apple targets as locally verified', () => {
    for (const id of ['windows', 'macos', 'ios', 'linux-x64', 'docker'] as const) {
      expect(getBuildTargetProfile(id).verification).toBe('remote-build-required')
    }
  })

  it('has a unique profile for every target', () => {
    expect(new Set(BUILD_TARGET_PROFILES.map((profile) => profile.id)).size).toBe(BUILD_TARGET_PROFILES.length)
  })

  it('ships remote targets in an explicit provider-unconfigured state', () => {
    expect(findRemoteBuildProvider('windows')).toBeNull()
  })

  it('accepts a versioned coding project record', () => {
    expect(CodingProjectRecordSchema.parse({
      schemaVersion: 1, id: 'project', taskId: 'task', name: 'Demo', targetId: 'web-static',
      supportLevel: 'stable', source: { kind: 'template', templateId: 'static-web-v1' }, workspaceKey: 'coding:project',
      buildConfig: { buildCommand: 'test -f index.html', artifactPatterns: ['index.html'] }, status: 'ready',
      dirtyExternalSync: false, createdAt: 1, updatedAt: 1,
    }).targetId).toBe('web-static')
  })
})
