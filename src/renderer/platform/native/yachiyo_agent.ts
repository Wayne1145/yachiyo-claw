import { registerPlugin } from '@capacitor/core'

export interface RootCommandResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

export interface WorkingDirectoryResult {
  canceled: boolean
  path?: string
  uri?: string
}

export interface NativeSkillScriptOptions {
  backend: 'root' | 'shizuku'
  skillName: string
  entrypointName: string
  runtime: 'shell' | 'python' | 'javascript'
  scriptBase64: string
  scriptSha256: string
  args: string[]
  workingDirectoryMode: 'skill-private' | 'workspace'
  workspaceDirectory: string
  timeout: number
  executionId: string
  signatureVerified: boolean
  approvalNonce?: string
}

interface YachiyoAgentNativePlugin {
  checkRoot(): Promise<{ available: boolean; detail: string }>
  execRoot(options: { command: string; timeout: number }): Promise<RootCommandResult>
  execRootSkillScript(options: NativeSkillScriptOptions): Promise<RootCommandResult>
  kill(): Promise<{ killed: boolean }>
  pickWorkingDirectory(): Promise<WorkingDirectoryResult>
}

const nativeAgent = registerPlugin<YachiyoAgentNativePlugin>('YachiyoAgent')

export const yachiyoAgentNative = {
  checkRoot: () => nativeAgent.checkRoot(),
  execRoot: (command: string, timeout = 120_000) => nativeAgent.execRoot({ command, timeout }),
  execRootSkillScript: (options: NativeSkillScriptOptions) => nativeAgent.execRootSkillScript(options),
  kill: () => nativeAgent.kill(),
  pickWorkingDirectory: () => nativeAgent.pickWorkingDirectory(),
}
