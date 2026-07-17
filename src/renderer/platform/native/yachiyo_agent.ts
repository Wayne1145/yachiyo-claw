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

interface YachiyoAgentNativePlugin {
  checkRoot(): Promise<{ available: boolean; detail: string }>
  execRoot(options: { command: string; timeout: number }): Promise<RootCommandResult>
  kill(): Promise<{ killed: boolean }>
  pickWorkingDirectory(): Promise<WorkingDirectoryResult>
}

const nativeAgent = registerPlugin<YachiyoAgentNativePlugin>('YachiyoAgent')

export const yachiyoAgentNative = {
  checkRoot: () => nativeAgent.checkRoot(),
  execRoot: (command: string, timeout = 120_000) => nativeAgent.execRoot({ command, timeout }),
  kill: () => nativeAgent.kill(),
  pickWorkingDirectory: () => nativeAgent.pickWorkingDirectory(),
}
