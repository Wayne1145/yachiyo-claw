import { v4 as uuidv4 } from 'uuid'
import { getBuildTargetProfile, type BuildTargetId, type CodingBuildRun, type CodingProjectRecord, type ToolchainCapabilitySnapshot } from '@shared/types'
import platform from '@/platform'
import { createTaskSession, updateTaskSession } from '@/stores/taskSessionStore'
import { codingProjectStorage } from '@/storage/CodingProjectStorage'
import { codingTemplateFiles } from './coding-templates'
import { startCodingBuildRun } from './coding-builds'

export async function inspectCodingToolchain(): Promise<ToolchainCapabilitySnapshot> {
  const status = await platform.sandboxStatus?.()
  const baseReady = Boolean(status?.toolchainReady)
  return {
    abi: status?.abi || 'unknown',
    freeBytes: Number(status?.freeBytes ?? 0),
    sandboxReady: baseReady,
    androidToolchainReady: Boolean(status?.androidToolchainReady),
    androidToolchainSupported: Boolean(status?.androidToolchainSupported),
    node: baseReady, python: baseReady, buildBase: baseReady,
    jdk: Boolean(status?.androidToolchainReady), gradle: Boolean(status?.androidToolchainReady),
    androidSdk: Boolean(status?.androidToolchainReady), aapt2: Boolean(status?.androidToolchainReady), capturedAt: Date.now(),
  }
}

export async function createCodingProject(input: { name: string; targetId: BuildTargetId; packageName: string }): Promise<CodingProjectRecord> {
  const profile = getBuildTargetProfile(input.targetId)
  if (!profile.templateId) throw new Error('coding_template_unavailable')
  const capability = await inspectCodingToolchain()
  if (!capability.sandboxReady) throw new Error('coding_sandbox_not_ready')
  if (capability.freeBytes > 0 && capability.freeBytes < profile.minimumFreeBytes) throw new Error('coding_storage_insufficient')
  if (profile.requirements.includes('android-sdk') && !capability.androidToolchainReady) throw new Error('coding_android_toolchain_not_ready')
  const projectId = uuidv4()
  const workspaceKey = `coding:${projectId}`
  const initialized = await platform.sandboxInit?.({ workingDirectory: workspaceKey })
  if (!initialized?.success) throw new Error(initialized?.error || 'coding_sandbox_unavailable')
  const task = await createTaskSession({ name: input.name, workingDirectory: workspaceKey, messages: [], mode: 'coding', codingProjectId: projectId })
  const now = Date.now()
  const project: CodingProjectRecord = {
    schemaVersion: 1, id: projectId, taskId: task.id, name: input.name, targetId: input.targetId,
    supportLevel: profile.supportLevel, source: { kind: 'template', templateId: profile.templateId }, workspaceKey,
    buildConfig: { installCommand: profile.installCommand, buildCommand: profile.buildCommand, testCommand: profile.testCommand, artifactPatterns: [...profile.artifactPatterns] },
    status: 'creating', dirtyExternalSync: false, createdAt: now, updatedAt: now,
  }
  await codingProjectStorage.put('projects', project)
  try {
    for (const file of codingTemplateFiles(input.targetId, input.name, input.packageName)) {
      const result = await platform.sandboxWrite?.({ filePath: file.path, content: file.content })
      if (!result?.success) throw new Error(result?.error || `coding_template_write_failed:${file.path}`)
    }
    const command = [profile.installCommand, profile.buildCommand].filter(Boolean).join(' && ')
    if (command) {
      await startCodingBuildRun(project, 'build', command, profile.category === 'android' ? 900_000 : 600_000)
      return { ...project, status: 'building' as const, updatedAt: Date.now() }
    }
    const ready = { ...project, status: 'ready' as const, updatedAt: Date.now() }
    await codingProjectStorage.put('projects', ready)
    return ready
  } catch (error) {
    const failed = { ...project, status: 'failed' as const, updatedAt: Date.now() }
    await codingProjectStorage.put('projects', failed)
    await updateTaskSession(task.id, { codingProjectId: projectId })
    throw error
  }
}

async function detectImportedTarget(): Promise<BuildTargetId> {
  const read = async (path: string) => Boolean((await platform.sandboxRead?.({ filePath: path }))?.success)
  if (await read('capacitor.config.ts') || await read('capacitor.config.json')) return 'android-capacitor'
  if (await read('settings.gradle') || await read('settings.gradle.kts')) return 'android-kotlin'
  if (await read('vite.config.ts') || await read('vite.config.js')) return 'web-vite'
  if (await read('package.json')) return 'node'
  if (await read('pyproject.toml') || await read('requirements.txt')) return 'python'
  if (await read('index.html')) return 'web-static'
  return 'linux-arm64'
}

export async function importCodingProject(): Promise<CodingProjectRecord | null> {
  const picked = await platform.pickExternalWorkspace?.()
  if (!picked || picked.canceled || !picked.workspaceKey) return null
  const synced = await platform.syncExternalWorkspace?.('in')
  if (!synced?.success) throw new Error(synced?.error || 'coding_workspace_import_failed')
  const initialized = await platform.sandboxInit?.({ workingDirectory: picked.workspaceKey })
  if (!initialized?.success) throw new Error(initialized?.error || 'coding_sandbox_unavailable')
  const targetId = await detectImportedTarget()
  const profile = getBuildTargetProfile(targetId)
  const projectId = uuidv4()
  const name = picked.displayName || 'Imported project'
  const task = await createTaskSession({ name, workingDirectory: picked.workspaceKey, messages: [], mode: 'coding', codingProjectId: projectId })
  const now = Date.now()
  const project: CodingProjectRecord = {
    schemaVersion: 1, id: projectId, taskId: task.id, name, targetId, supportLevel: profile.supportLevel,
    source: { kind: 'saf' }, workspaceKey: picked.workspaceKey,
    buildConfig: { installCommand: profile.installCommand, buildCommand: profile.buildCommand, testCommand: profile.testCommand, artifactPatterns: [...profile.artifactPatterns] },
    status: 'ready', dirtyExternalSync: false, createdAt: now, updatedAt: now,
  }
  await codingProjectStorage.put('projects', project)
  return project
}
