import { ipcMain } from 'electron'
import { getLogger } from '../util'
import {
  checkAvailability,
  editFile,
  execCommand,
  findFiles,
  getStatus,
  grepFiles,
  initSandbox,
  killRunningCommand,
  listDir,
  readFile,
  resetSandbox,
  writeFile,
} from './manager'

const log = getLogger('sandbox:ipc-handlers')

export function registerSandboxIPCHandlers() {
  ipcMain.handle('sandbox:init', async (_event, params: { workingDirectory: string }) => {
    try {
      log.info(`sandbox:init workDir=${params.workingDirectory}`)
      return await initSandbox(params.workingDirectory)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:init failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:exec', async (_event, params: { command: string; timeout?: number; cwd?: string }) => {
    try {
      log.debug(`sandbox:exec command=${params.command}`)
      return await execCommand(params.command, { timeout: params.timeout, cwd: params.cwd })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:exec failed', msg)
      return { stdout: '', stderr: msg, exitCode: 1 }
    }
  })

  ipcMain.handle('sandbox:read', async (_event, params: { filePath: string }) => {
    try {
      log.debug(`sandbox:read path=${params.filePath}`)
      return await readFile(params.filePath)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:read failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:write', async (_event, params: { filePath: string; content: string }) => {
    try {
      log.debug(`sandbox:write path=${params.filePath}`)
      return await writeFile(params.filePath, params.content)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:write failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:edit', async (_event, params: { filePath: string; search: string; replace: string }) => {
    try {
      log.debug(`sandbox:edit path=${params.filePath}`)
      return await editFile(params.filePath, params.search, params.replace)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:edit failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:ls', async (_event, params: { dirPath: string }) => {
    try {
      log.debug(`sandbox:ls path=${params.dirPath}`)
      return await listDir(params.dirPath)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:ls failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:grep', async (_event, params: { pattern: string; dirPath?: string; include?: string }) => {
    try {
      log.debug(`sandbox:grep pattern=${params.pattern}`)
      return await grepFiles(params.pattern, params.dirPath, { include: params.include })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:grep failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:find', async (_event, params: { dirPath: string; pattern?: string }) => {
    try {
      log.debug(`sandbox:find dir=${params.dirPath}`)
      return await findFiles(params.dirPath, params.pattern)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:find failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:kill', () => {
    try {
      log.info('sandbox:kill')
      return killRunningCommand()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:kill failed', msg)
      return { killed: false }
    }
  })

  ipcMain.handle('sandbox:reset', async () => {
    try {
      log.info('sandbox:reset')
      return await resetSandbox()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:reset failed', msg)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('sandbox:status', () => {
    return getStatus()
  })

  ipcMain.handle('sandbox:check-availability', async () => {
    try {
      return await checkAvailability()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error('sandbox:check-availability failed', msg)
      return { available: false, reason: msg }
    }
  })

  log.info('Sandbox IPC handlers registered')
}
