import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import log from 'electron-log/main'

const sqliteSidecarSuffixes = ['', '-wal', '-shm', '-journal'] as const

type MigrationFileStatus = 'pending' | 'missing-source' | 'skipped-target-exists' | 'copying' | 'copied' | 'failed'

type MigrationDebugState = {
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  updatedAt: string
  completedAt?: string
  source: string
  target: string
  files: Record<string, { source: string; target: string; status: MigrationFileStatus; error?: string }>
}

function writeMigrationDebugFile(debugPath: string, state: MigrationDebugState) {
  fs.writeFileSync(
    debugPath,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
}

function migrateLegacyKnowledgeBaseDatabase() {
  const userDataPath = app.getPath('userData')
  const legacyDbPath = path.join(userDataPath, 'databases', 'chatbox_kb.db')
  const targetDbPath = path.join(userDataPath, 'chatbox-databases', 'chatbox_kb.db')
  const targetDir = path.dirname(targetDbPath)
  const debugPath = path.join(targetDir, 'chatbox_kb_migration_debug.txt')

  if (fs.existsSync(targetDbPath) || !fs.existsSync(legacyDbPath)) {
    return
  }

  fs.mkdirSync(targetDir, { recursive: true })

  const debugState: MigrationDebugState = {
    status: 'running',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: legacyDbPath,
    target: targetDbPath,
    files: Object.fromEntries(
      sqliteSidecarSuffixes.map((suffix) => {
        const label = suffix || '<main-db>'
        return [
          label,
          {
            source: `${legacyDbPath}${suffix}`,
            target: `${targetDbPath}${suffix}`,
            status: 'pending' as const,
          },
        ]
      })
    ),
  }
  writeMigrationDebugFile(debugPath, debugState)

  for (const suffix of sqliteSidecarSuffixes) {
    const label = suffix || '<main-db>'
    const sourcePath = `${legacyDbPath}${suffix}`
    const targetPath = `${targetDbPath}${suffix}`
    if (!fs.existsSync(sourcePath)) {
      debugState.files[label].status = 'missing-source'
      writeMigrationDebugFile(debugPath, debugState)
      continue
    }
    if (fs.existsSync(targetPath)) {
      debugState.files[label].status = 'skipped-target-exists'
      writeMigrationDebugFile(debugPath, debugState)
      continue
    }

    debugState.files[label].status = 'copying'
    writeMigrationDebugFile(debugPath, debugState)
    try {
      fs.copyFileSync(sourcePath, targetPath)
      debugState.files[label].status = 'copied'
      writeMigrationDebugFile(debugPath, debugState)
    } catch (error) {
      debugState.status = 'failed'
      debugState.files[label].status = 'failed'
      debugState.files[label].error = error instanceof Error ? error.message : String(error)
      writeMigrationDebugFile(debugPath, debugState)
      throw error
    }
  }

  debugState.status = 'completed'
  debugState.completedAt = new Date().toISOString()
  writeMigrationDebugFile(debugPath, debugState)

  log.info(`[DB] Migrated knowledge base sqlite files: ${legacyDbPath} -> ${targetDbPath}`)
}

migrateLegacyKnowledgeBaseDatabase()
