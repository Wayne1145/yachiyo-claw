import { v4 as uuidv4 } from 'uuid'
import type { CodingBuildRun, CodingProjectRecord } from '@shared/types'
import platform from '@/platform'
import { codingProjectStorage } from '@/storage/CodingProjectStorage'

const ACTIVE_STATES = new Set<CodingBuildRun['state']>(['queued', 'running'])

export function artifactPathMatches(path: string, patterns: readonly string[]): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '')
  return patterns.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
    const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const regex = escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
    return new RegExp(`^${regex}$`).test(normalized)
  })
}

function mapNativeState(state: string): CodingBuildRun['state'] {
  if (state === 'succeeded') return 'completed'
  if (state === 'failed') return 'failed'
  if (state === 'cancelled') return 'cancelled'
  if (state === 'interrupted') return 'needs-check'
  return state === 'running' ? 'running' : 'queued'
}

export async function reconcileCodingBuildRuns(project: CodingProjectRecord): Promise<CodingBuildRun[]> {
  const runs = await codingProjectStorage.list<CodingBuildRun>('builds', project.id)
  const reconciled = await Promise.all(runs.map(async (run) => {
    if (!ACTIVE_STATES.has(run.state) || !run.nativeJobId || !platform.sandboxQueryJob) return run
    try {
      const native = await platform.sandboxQueryJob({ jobId: run.nativeJobId })
      const state = mapNativeState(native.state)
      const next: CodingBuildRun = {
        ...run,
        state,
        exitCode: native.exitCode,
        ...(ACTIVE_STATES.has(state) ? {} : { completedAt: native.updatedAt || Date.now() }),
      }
      await codingProjectStorage.put('builds', next)
      return next
    } catch {
      const next = { ...run, state: 'needs-check' as const, completedAt: Date.now() }
      await codingProjectStorage.put('builds', next)
      return next
    }
  }))
  const active = reconciled.some((run) => ACTIVE_STATES.has(run.state))
  const latest = [...reconciled].sort((left, right) => right.startedAt - left.startedAt)[0]
  const status = active ? 'building' : latest?.state === 'failed' ? 'failed' : project.status === 'changing' ? 'changing' : 'ready'
  if (status !== project.status) {
    await codingProjectStorage.put('projects', { ...project, status, updatedAt: Date.now() })
  }
  return reconciled
}

export async function startCodingBuildRun(
  project: CodingProjectRecord,
  kind: CodingBuildRun['kind'],
  command: string,
  timeout: number,
): Promise<CodingBuildRun> {
  if (!command.trim()) throw new Error('coding_command_unavailable')
  const runs = await reconcileCodingBuildRuns(project)
  if (runs.some((run) => ACTIVE_STATES.has(run.state))) throw new Error('coding_build_already_running')
  if (!platform.sandboxStartBackground) throw new Error('coding_background_unavailable')
  const native = await platform.sandboxStartBackground({ command, timeout, alwaysAsk: true })
  if (!native.accepted) throw new Error('coding_background_rejected')
  const now = Date.now()
  const run: CodingBuildRun = {
    schemaVersion: 1,
    id: uuidv4(),
    projectId: project.id,
    kind,
    command,
    state: 'queued',
    nativeJobId: native.jobId,
    startedAt: now,
  }
  await codingProjectStorage.put('builds', run)
  await codingProjectStorage.put('projects', { ...project, status: 'building', updatedAt: now })
  return run
}
