import { tool } from 'ai'
import { z } from 'zod'
import { getBuildTargetProfile, type CodingProjectRecord } from '@shared/types'
import platform from '@/platform'
import { startCodingBuildRun } from '@/mobile/coding-builds'
import { proposeCodingChangeSet } from '@/mobile/coding-changes'
import { codingProjectStorage } from '@/storage/CodingProjectStorage'

async function git(operation: Parameters<NonNullable<typeof platform.codingGit>>[0]) {
  if (!platform.codingGit) return { stdout: '', stderr: 'coding_git_unavailable', exitCode: 127 }
  return platform.codingGit(operation)
}

export function createCodingToolSet(project: CodingProjectRecord) {
  const profile = getBuildTargetProfile(project.targetId)
  const remoteNotice = profile.verification === 'remote-build-required'
    ? 'This target requires a remote builder. You may prepare source, but must never claim a local build or local verification.'
    : profile.verification === 'local-source-only'
      ? 'This target is source-only on this phone. Do not claim that its final artifact was built or verified.'
      : 'This target supports local build and verification on a compatible phone.'

  return {
    description: `\n<coding_project target="${profile.id}" support="${profile.supportLevel}" verification="${profile.verification}">${remoteNotice} Propose every model-generated file mutation as one reviewable change set. Do not use shell redirection or generic write tools.</coding_project>\n`,
    tools: {
      coding_propose_changes: tool({
        description: 'Propose a reviewable multi-file change set. This does not modify files; the user reviews it in Changes.',
        inputSchema: z.object({
          objective: z.string().min(1).max(6_000),
          operations: z.array(z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('create'), path: z.string(), content: z.string() }),
            z.object({ kind: z.literal('update'), path: z.string(), content: z.string() }),
            z.object({ kind: z.literal('delete'), path: z.string() }),
          ])).min(1).max(200),
        }),
        execute: ({ objective, operations }) => proposeCodingChangeSet(project, objective, operations),
      }),
      coding_run_profile: tool({
        description: 'Run the target profile install, build, or test command as an approved persistent job.',
        inputSchema: z.object({ kind: z.enum(['install', 'build', 'test']) }),
        execute: async ({ kind }) => {
          if (profile.verification !== 'local-build-and-verify') return { accepted: false, reason: profile.verification }
          const command = kind === 'install' ? profile.installCommand : kind === 'test' ? profile.testCommand : profile.buildCommand
          if (!command) return { accepted: false, reason: `coding_${kind}_unavailable` }
          const run = await startCodingBuildRun(project, kind, command, kind === 'build' ? 900_000 : 600_000)
          return { accepted: true, buildRunId: run.id, nativeJobId: run.nativeJobId }
        },
      }),
      coding_git_status: tool({ description: 'Read Git status.', inputSchema: z.object({}), execute: () => git({ kind: 'status' }) }),
      coding_git_diff: tool({ description: 'Read the current Git diff.', inputSchema: z.object({ staged: z.boolean().default(false) }), execute: ({ staged }) => git({ kind: 'diff', staged }) }),
      coding_git_create_branch: tool({
        description: 'Create and switch to a new Git branch after approval.',
        inputSchema: z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/) }),
        execute: ({ name }) => git({ kind: 'create-branch', name }),
      }),
      coding_git_commit: tool({
        description: 'Commit the reviewed working tree. Never pushes.',
        inputSchema: z.object({ message: z.string().min(1).max(500) }),
        execute: ({ message }) => git({ kind: 'commit', message }),
      }),
      coding_git_restore_files: tool({
        description: 'Restore explicitly listed files after destructive-operation approval.',
        inputSchema: z.object({ paths: z.array(z.string().min(1).max(2_048)).min(1).max(50) }),
        execute: ({ paths }) => git({ kind: 'restore-files', paths }),
      }),
    },
  }
}
