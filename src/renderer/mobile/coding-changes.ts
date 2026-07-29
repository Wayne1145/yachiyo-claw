import { v4 as uuidv4 } from 'uuid'
import type { CodingChangeOperation, CodingChangeSet, CodingProjectRecord } from '@shared/types'
import { validateWorkspaceRelativePath } from '@shared/agent/workspace'
import { CORE_AGENT_PRINCIPAL } from '@shared/agent'
import platform from '@/platform'
import { codingProjectStorage } from '@/storage/CodingProjectStorage'
import { requestAgentApproval } from './agent-approval'

const MAX_CHANGESET_BYTES = 8 * 1024 * 1024
const MAX_CODING_FILE_BYTES = 1024 * 1024

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export interface ProposedCodingOperation {
  kind: 'create' | 'update' | 'delete'
  path: string
  content?: string
}

export async function proposeCodingChangeSet(
  project: CodingProjectRecord,
  objective: string,
  proposed: ProposedCodingOperation[],
): Promise<CodingChangeSet> {
  let bytes = 0
  const operations: CodingChangeOperation[] = []
  const paths = new Set<string>()
  for (const item of proposed) {
    const path = validateWorkspaceRelativePath(item.path)
    if (paths.has(path)) throw new Error(`coding_duplicate_path:${path}`)
    paths.add(path)
    const current = await platform.sandboxRead?.({ filePath: path })
    const baseContent = current?.success ? current.content ?? '' : null
    if (item.kind === 'create') {
      if (baseContent !== null) throw new Error(`coding_file_exists:${path}`)
      const content = item.content ?? ''
      const contentBytes = new TextEncoder().encode(content).byteLength
      if (contentBytes > MAX_CODING_FILE_BYTES) throw new Error(`coding_file_too_large:${path}`)
      bytes += contentBytes
      operations.push({ kind: 'create', path, content })
      continue
    }
    if (baseContent === null) throw new Error(`coding_file_not_found:${path}`)
    const baseBytes = new TextEncoder().encode(baseContent).byteLength
    if (baseBytes > MAX_CODING_FILE_BYTES) throw new Error(`coding_file_too_large:${path}`)
    bytes += baseBytes
    if (item.kind === 'delete') {
      operations.push({ kind: 'delete', path, baseSha256: await sha256(baseContent), baseContent })
    } else {
      const content = item.content ?? ''
      const contentBytes = new TextEncoder().encode(content).byteLength
      if (contentBytes > MAX_CODING_FILE_BYTES) throw new Error(`coding_file_too_large:${path}`)
      bytes += contentBytes
      operations.push({ kind: 'update', path, content, baseSha256: await sha256(baseContent), baseContent })
    }
  }
  if (bytes > MAX_CHANGESET_BYTES) throw new Error('coding_changeset_too_large')
  const now = Date.now()
  const record: CodingChangeSet = {
    schemaVersion: 1,
    id: uuidv4(),
    projectId: project.id,
    objective: objective.trim().slice(0, 6_000),
    operations,
    state: 'pending',
    createdAt: now,
    updatedAt: now,
  }
  await codingProjectStorage.put('changesets', record)
  await codingProjectStorage.put('projects', { ...project, status: 'changing', updatedAt: now })
  return record
}

async function currentContent(operation: CodingChangeOperation): Promise<string | null> {
  const result = await platform.sandboxRead?.({ filePath: operation.path })
  return result?.success ? result.content ?? '' : null
}

export async function applyCodingChangeSet(
  project: CodingProjectRecord,
  changeSet: CodingChangeSet,
  sessionId = project.taskId,
  includedPaths?: readonly string[],
): Promise<CodingChangeSet> {
  if (changeSet.projectId !== project.id || changeSet.state !== 'pending') throw new Error('coding_changeset_not_pending')
  const selectedPaths = includedPaths ? new Set(includedPaths.map(validateWorkspaceRelativePath)) : null
  const operations = selectedPaths
    ? changeSet.operations.filter((operation) => selectedPaths.has(operation.path))
    : changeSet.operations
  if (operations.length === 0 || (selectedPaths && operations.length !== selectedPaths.size)) {
    throw new Error('coding_changeset_selection_invalid')
  }
  for (const operation of operations) {
    const current = await currentContent(operation)
    if (operation.kind === 'create' ? current !== null : current === null || (await sha256(current)) !== operation.baseSha256) {
      const conflict = { ...changeSet, state: 'conflict' as const, updatedAt: Date.now(), error: `coding_file_changed:${operation.path}` }
      await codingProjectStorage.put('changesets', conflict)
      return conflict
    }
  }
  const detail = operations.map((operation) => `${operation.kind}: ${operation.path}`).join('\n')
  const approved = await requestAgentApproval({
    principal: CORE_AGENT_PRINCIPAL,
    sessionId,
    title: `应用 ${operations.length} 项代码改动`,
    detail,
    risk: 'dangerous',
    mutating: true,
    alwaysAsk: true,
    rememberConversationApproval: false,
  })
  if (!approved) return changeSet

  const applying = { ...changeSet, state: 'applying' as const, updatedAt: Date.now() }
  await codingProjectStorage.put('changesets', applying)
  const completed: CodingChangeOperation[] = []
  try {
    for (const operation of operations) {
      if (operation.kind === 'delete') {
        if (!platform.sandboxDelete) throw new Error('coding_delete_unavailable')
        const result = await platform.sandboxDelete({ filePath: operation.path })
        if (!result.success) throw new Error(result.error || 'coding_delete_failed')
      } else {
        if (!platform.sandboxWrite) throw new Error('coding_write_unavailable')
        const result = await platform.sandboxWrite({ filePath: operation.path, content: operation.content })
        if (!result.success) throw new Error(result.error || 'coding_write_failed')
      }
      completed.push(operation)
    }
  } catch (error) {
    for (const operation of completed.reverse()) {
      if (operation.kind === 'create') await platform.sandboxDelete?.({ filePath: operation.path }).catch(() => undefined)
      else await platform.sandboxWrite?.({ filePath: operation.path, content: operation.baseContent ?? '' }).catch(() => undefined)
    }
    const failed = { ...changeSet, state: 'failed' as const, updatedAt: Date.now(), error: error instanceof Error ? error.message : String(error) }
    await codingProjectStorage.put('changesets', failed)
    return failed
  }
  const remaining = changeSet.operations.filter((operation) => !operations.includes(operation))
  const now = Date.now()
  if (remaining.length > 0) {
    await codingProjectStorage.put('changesets', {
      ...changeSet,
      id: uuidv4(),
      operations,
      state: 'applied',
      createdAt: now,
      updatedAt: now,
    })
    const pending = { ...changeSet, operations: remaining, state: 'pending' as const, updatedAt: now }
    await codingProjectStorage.put('changesets', pending)
    await codingProjectStorage.put('projects', {
      ...project,
      status: 'changing',
      dirtyExternalSync: project.source.kind === 'saf',
      updatedAt: now,
    })
    return pending
  }
  const applied = { ...changeSet, state: 'applied' as const, updatedAt: now }
  await codingProjectStorage.put('changesets', applied)
  await codingProjectStorage.put('projects', { ...project, status: 'ready', dirtyExternalSync: project.source.kind === 'saf', updatedAt: now })
  return applied
}

export async function rejectCodingChangeSet(changeSet: CodingChangeSet): Promise<CodingChangeSet> {
  const rejected = { ...changeSet, state: 'rejected' as const, updatedAt: Date.now() }
  await codingProjectStorage.put('changesets', rejected)
  return rejected
}

export async function rejectCodingChangeFiles(
  changeSet: CodingChangeSet,
  rejectedPaths: readonly string[],
): Promise<CodingChangeSet> {
  if (changeSet.state !== 'pending') throw new Error('coding_changeset_not_pending')
  const paths = new Set(rejectedPaths.map(validateWorkspaceRelativePath))
  const rejectedOperations = changeSet.operations.filter((operation) => paths.has(operation.path))
  if (rejectedOperations.length === 0 || rejectedOperations.length !== paths.size) {
    throw new Error('coding_changeset_selection_invalid')
  }
  const remaining = changeSet.operations.filter((operation) => !paths.has(operation.path))
  if (remaining.length === 0) return rejectCodingChangeSet(changeSet)
  const now = Date.now()
  await codingProjectStorage.put('changesets', {
    ...changeSet,
    id: uuidv4(),
    operations: rejectedOperations,
    state: 'rejected',
    createdAt: now,
    updatedAt: now,
  })
  const pending = { ...changeSet, operations: remaining, updatedAt: now }
  await codingProjectStorage.put('changesets', pending)
  return pending
}
