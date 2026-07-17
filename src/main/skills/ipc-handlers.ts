import type { MarketplaceSkill } from '@shared/types/skills'
import { spawn } from 'child_process'
import { app, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { getLogger } from '../util'
import { discoverSkills } from './discovery'
import { detectSkillsInRepo } from './github-fetcher'
import { checkForUpdates, deleteSkill, installSkillFromGitHub, installSkillFromMarketplace } from './installer'
import { parseSkillFile } from './parser'
import { isValidSkillName } from './validation'

const log = getLogger('skills:ipc-handlers')
function getSkillsDir(): string {
  return path.join(app.getPath('userData'), 'skills')
}

export function registerSkillsHandlers() {
  ipcMain.handle('skills:discover', async () => {
    try {
      const skillsDir = getSkillsDir()
      return discoverSkills(skillsDir)
    } catch (error) {
      log.error('skills:discover failed', error)
      throw error
    }
  })

  ipcMain.handle('skills:load', async (_event, name: string) => {
    try {
      if (!name || typeof name !== 'string') {
        return null
      }
      if (!isValidSkillName(name)) {
        return null
      }

      const skillsDir = getSkillsDir()
      if (!fs.existsSync(skillsDir)) {
        return null
      }
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
        if (!fs.existsSync(skillMdPath)) continue

        const parsed = parseSkillFile(skillMdPath, entry.name)
        if (parsed && parsed.metadata.name === name) {
          return { body: parsed.body, metadata: parsed.metadata }
        }
      }

      return null
    } catch (error) {
      log.error(`skills:load failed for name=${name}`, error)
      throw error
    }
  })

  ipcMain.handle('skills:get-directory', async () => {
    return getSkillsDir()
  })

  ipcMain.handle('skills:open-directory', async () => {
    try {
      const skillsDir = getSkillsDir()
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true })
      }
      await shell.openPath(skillsDir)
      return { success: true }
    } catch (error) {
      log.error('skills:open-directory failed', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  ipcMain.handle(
    'skills:execute-script',
    async (
      _event,
      params: { skillName: string; scriptName: string; args?: string[] }
    ): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null }> => {
      const { skillName, scriptName, args = [] } = params

      try {
        if (!skillName || !scriptName) {
          throw new Error('Skill name and script name are required')
        }

        if (skillName.includes('..') || skillName.includes('/') || skillName.includes('\\')) {
          throw new Error('Invalid skill name: path traversal not allowed')
        }

        if (scriptName.includes('..') || scriptName.includes('/') || scriptName.includes('\\')) {
          throw new Error('Invalid script name: path traversal not allowed')
        }

        const skillsDir = getSkillsDir()
        const scriptPath = path.join(skillsDir, skillName, 'scripts', scriptName)
        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Script not found: ${scriptName}`)
        }
        const resolvedSkillsDir = fs.realpathSync(skillsDir)
        const resolvedScriptPath = fs.realpathSync(scriptPath)
        if (!resolvedScriptPath.startsWith(`${resolvedSkillsDir}${path.sep}`)) {
          throw new Error('Script path escapes skills directory')
        }

        const scriptDir = path.dirname(resolvedScriptPath)

        return await new Promise((resolve) => {
          const TIMEOUT_MS = 30_000
          let stdout = ''
          let stderr = ''
          let settled = false

          const resolveOnce = (result: {
            success: boolean
            stdout: string
            stderr: string
            exitCode: number | null
          }) => {
            if (settled) {
              return
            }
            settled = true
            resolve(result)
          }

          const child = spawn(resolvedScriptPath, args, {
            cwd: scriptDir,
            timeout: TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              PATH: process.env.PATH,
              HOME: process.env.HOME,
              LANG: process.env.LANG,
              TERM: process.env.TERM,
              SKILL_DIR: path.join(skillsDir, skillName),
            },
          })

          const MAX_OUTPUT_BYTES = 1024 * 1024 // 1MB
          child.stdout.on('data', (data: Buffer) => {
            if (stdout.length < MAX_OUTPUT_BYTES) stdout += data.toString()
          })

          child.stderr.on('data', (data: Buffer) => {
            if (stderr.length < MAX_OUTPUT_BYTES) stderr += data.toString()
          })

          child.on('error', (error) => {
            log.error(`skills:execute-script spawn error for ${skillName}/${scriptName}`, error)
            resolveOnce({ success: false, stdout, stderr: stderr || error.message, exitCode: null })
          })

          child.on('close', (code, signal) => {
            if (signal === 'SIGTERM') {
              resolveOnce({ success: false, stdout, stderr: stderr || 'Script timed out', exitCode: null })
            } else {
              resolveOnce({ success: code === 0, stdout, stderr, exitCode: code })
            }
          })

          setTimeout(() => {
            if (settled) {
              return
            }
            if (!child.killed) {
              child.kill('SIGTERM')
              resolveOnce({ success: false, stdout, stderr: stderr || 'Script timed out (30s)', exitCode: null })
            }
          }, TIMEOUT_MS)
        })
      } catch (error) {
        log.error(`skills:execute-script failed for ${skillName}/${scriptName}`, error)
        return {
          success: false,
          stdout: '',
          stderr: error instanceof Error ? error.message : 'Unknown error',
          exitCode: null,
        }
      }
    }
  )

  ipcMain.handle('skills:scan-repo', async (_event, owner: string, repo: string) => {
    try {
      return await detectSkillsInRepo(owner, repo)
    } catch (error) {
      log.error(`skills:scan-repo failed for ${owner}/${repo}`, error)
      throw error
    }
  })

  ipcMain.handle('skills:install', async (_event, params: { owner: string; repo: string; skillPath: string }) => {
    try {
      return await installSkillFromGitHub(params.owner, params.repo, params.skillPath)
    } catch (error) {
      log.error('skills:install failed', error)
      throw error
    }
  })

  ipcMain.handle('skills:install-marketplace', async (_event, skill: MarketplaceSkill) => {
    try {
      return await installSkillFromMarketplace(skill)
    } catch (error) {
      log.error('skills:install-marketplace failed', error)
      throw error
    }
  })

  ipcMain.handle('skills:delete', async (_event, skillName: string) => {
    try {
      return await deleteSkill(skillName)
    } catch (error) {
      log.error(`skills:delete failed for "${skillName}"`, error)
      throw error
    }
  })

  ipcMain.handle('skills:check-update', async (_event, skillName: string) => {
    try {
      return await checkForUpdates(skillName)
    } catch (error) {
      log.error(`skills:check-update failed for "${skillName}"`, error)
      throw error
    }
  })

  ipcMain.handle('skills:check-updates-batch', async () => {
    try {
      const skillsDir = getSkillsDir()
      const results: Record<string, { hasUpdate: boolean; error?: string }> = {}

      if (!fs.existsSync(skillsDir)) return results

      const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const sourcePath = path.join(skillsDir, entry.name, 'source.json')
        if (!fs.existsSync(sourcePath)) continue

        const result = await checkForUpdates(entry.name)
        results[entry.name] = { hasUpdate: result.hasUpdate, error: result.error }
      }

      return results
    } catch (error) {
      log.error('skills:check-updates-batch failed', error)
      throw error
    }
  })
}
