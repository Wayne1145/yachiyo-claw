#!/usr/bin/env node

import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { _electron } from 'playwright'

const DEFAULT_FIXTURES_REPO = '../../chatbox-session-rag-eval-fixtures'
const DEFAULT_CASE_ID = 'long-citrine-threshold'
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), 'Library/Application Support/xyz.chatboxapp.app/config.json')

function parseArgs(argv) {
  const args = {
    fixturesRepo: DEFAULT_FIXTURES_REPO,
    caseId: DEFAULT_CASE_ID,
    configPath: DEFAULT_CONFIG_PATH,
    keepUserData: false,
    timeoutMs: 8 * 60 * 1000,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--fixtures-repo') {
      args.fixturesRepo = argv[++i]
    } else if (arg === '--case') {
      args.caseId = argv[++i]
    } else if (arg === '--config') {
      args.configPath = argv[++i]
    } else if (arg === '--keep-user-data') {
      args.keepUserData = true
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[++i])
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function loadCase(fixturesRepo, caseId) {
  const cases = await readJson(path.join(fixturesRepo, 'cases/session-attachment-rag-cases.json'))
  const testCase = cases.find((item) => item.id === caseId)
  if (!testCase) {
    throw new Error(`Case not found: ${caseId}`)
  }
  return {
    ...testCase,
    attachmentPaths: testCase.attachments.map((attachment) => path.join(fixturesRepo, attachment.path)),
  }
}

function getTurns(testCase) {
  if (!Array.isArray(testCase.turns) || testCase.turns.length === 0) {
    return [{ user: testCase.user }]
  }
  return testCase.turns.map((turn) => (typeof turn === 'string' ? { user: turn } : turn))
}

async function seedUserData(configPath) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbox-session-rag-eval-'))
  const sessionRagDbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatbox-session-rag-eval-db-'))
  const config = await readJson(configPath)
  config.settings = config.settings || {}
  config.settings.defaultChatModel = config.settings.defaultChatModel || {
    provider: 'chatbox-ai',
    model: config.settings.licenseDetail?.defaultModel || 'chatboxai-4',
  }
  await fs.writeFile(path.join(userDataDir, 'config.json'), JSON.stringify(config, null, 2))
  return {
    userDataDir,
    sessionRagDbPath: path.join(sessionRagDbDir, 'chatbox_session_rag.db'),
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local debugging port'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function resolveElectronEntry(cwd) {
  const candidates = [
    path.resolve(cwd, 'out/main/main.js'),
    path.resolve(cwd, 'release/app/dist/main/main.js'),
  ]
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate
    }
  }
  throw new Error('Built Electron entry not found. Run the project build first.')
}

function getRendererDirForEntry(electronEntry) {
  if (electronEntry.includes(`${path.sep}out${path.sep}main${path.sep}`)) {
    return path.resolve(path.dirname(electronEntry), '../renderer')
  }
  return path.resolve(path.dirname(electronEntry), '../renderer')
}

async function assertRendererUsesLocalApi(rendererDir) {
  const jsDir = path.join(rendererDir, 'js')
  const entries = await fs.readdir(jsDir).catch(() => [])
  const jsFiles = entries.filter((entry) => entry.endsWith('.js'))
  for (const jsFile of jsFiles) {
    const content = await fs.readFile(path.join(jsDir, jsFile), 'utf8').catch(() => '')
    if (content.includes('http://localhost:8002')) {
      return
    }
  }
  throw new Error(
    [
      'Renderer bundle is not built for the local Chatbox API.',
      'Rebuild before running this eval:',
      '  USE_LOCAL_API=true node ./node_modules/electron-vite/bin/electron-vite.js build --mode development',
    ].join('\n')
  )
}

async function readChatboxStore(page) {
  return page.evaluate(async () => {
    function requestToPromise(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }

    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('chatboxstore')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    try {
      const storeName = db.objectStoreNames.contains('keyvaluepairs')
        ? 'keyvaluepairs'
        : Array.from(db.objectStoreNames)[0]
      if (!storeName) {
        return {}
      }
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const keys = await requestToPromise(store.getAllKeys())
      const result = {}
      for (const key of keys) {
        const value = await requestToPromise(store.get(key))
        if (typeof key === 'string') {
          try {
            result[key] = typeof value === 'string' ? JSON.parse(value) : value
          } catch {
            result[key] = value
          }
        }
      }
      return result
    } finally {
      db.close()
    }
  })
}

function extractMessagesForCase(storeValues, userText) {
  const sessions = Object.entries(storeValues)
    .filter(([key]) => key.startsWith('session:'))
    .map(([, value]) => value)
    .filter((value) => value && Array.isArray(value.messages))

  return sessions
    .flatMap((session) =>
      session.messages.map((message, index) => ({
        session,
        message,
        index,
      }))
    )
    .filter(({ message }) =>
      (message.contentParts ?? []).some((part) => part.type === 'text' && String(part.text).includes(userText))
    )
    .map(({ session, index }) => ({
      session,
      messages: session.messages.slice(index),
    }))
    .at(-1)
}

function collectToolCalls(messages) {
  return messages.flatMap((message) =>
    (message.contentParts ?? [])
      .filter((part) => part.type === 'tool-call')
      .map((part) => ({
        toolName: part.toolName,
        state: part.state,
        args: part.args,
        result: part.result,
      }))
  )
}

function collectAssistantText(messages) {
  return messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.contentParts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

async function waitForIndexedAttachments(page, filenames, timeoutMs) {
  await page.waitForFunction(
    async (expectedFilenames) => {
      const win = window
      const snapshot = await win.electronAPI.invoke('session-attachment-rag:get-debug-snapshot')
      const ready = new Set(
        snapshot.recentAttachments
          .filter((attachment) => attachment.status === 'ready')
          .map((attachment) => attachment.filename)
      )
      return expectedFilenames.every((filename) => ready.has(filename))
    },
    filenames,
    { timeout: timeoutMs, polling: 1500 }
  )
  await page.waitForTimeout(2000)
}

async function waitForCaseResult(page, testCase, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastSnapshot = null

  while (Date.now() < deadline) {
    const storeValues = await readChatboxStore(page)
    const match = extractMessagesForCase(storeValues, testCase.user)
    if (match) {
      const messages = match.messages
      const assistantMessages = messages.filter((message) => message.role === 'assistant')
      const stillGenerating = assistantMessages.some((message) => message.generating)
      const toolCalls = collectToolCalls(messages)
      const answer = collectAssistantText(messages)
      lastSnapshot = { answer, toolCalls, stillGenerating }
      if (!stillGenerating && answer.trim()) {
        return lastSnapshot
      }
    }
    await page.waitForTimeout(2000)
  }

  throw new Error(`Timed out waiting for assistant result. Last snapshot: ${JSON.stringify(lastSnapshot)}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const fixturesRepo = path.resolve(process.cwd(), args.fixturesRepo)
  const testCase = await loadCase(fixturesRepo, args.caseId)
  const { userDataDir, sessionRagDbPath } = await seedUserData(path.resolve(args.configPath))
  const electronEntry = await resolveElectronEntry(process.cwd())
  const debuggingPort = await getFreePort()
  await assertRendererUsesLocalApi(getRendererDirForEntry(electronEntry))
  console.error(`Running case ${testCase.id}`)
  console.error(`Using userDataDir: ${userDataDir}`)
  console.error(`Using session RAG db: ${sessionRagDbPath}`)
  console.error(`Using CDP port: ${debuggingPort}`)

  const electronApp = await _electron.launch({
    args: [electronEntry, `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debuggingPort}`],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      USE_LOCAL_API: process.env.USE_LOCAL_API ?? 'true',
      SESSION_ATTACHMENT_RAG_DB_PATH: sessionRagDbPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('textarea').first().waitFor({ timeout: 60000 })
    console.error('Renderer is ready')

    const fileInput = page.locator('input[type="file"]').last()
    await fileInput.setInputFiles(testCase.attachmentPaths)
    console.error(`Uploaded ${testCase.attachmentPaths.length} attachment(s)`)

    await waitForIndexedAttachments(
      page,
      testCase.attachments.map((attachment) => attachment.filename),
      args.timeoutMs
    )
    console.error('Attachments indexed')

    const turns = getTurns(testCase)
    let result
    for (const [index, turn] of turns.entries()) {
      const textarea = page.locator('textarea').first()
      await textarea.fill(turn.user)
      const sendButton = page.locator('button.shrink-0.mb-1').first()
      await sendButton.waitFor({ state: 'visible', timeout: 10000 })
      await sendButton.click()
      await page.waitForFunction(() => document.querySelector('textarea')?.value === '', { timeout: 10000 })
      console.error(`Submitted user message ${index + 1}/${turns.length}`)
      result = await waitForCaseResult(page, { ...testCase, user: turn.user }, args.timeoutMs)
    }
    if (!result) {
      throw new Error('No turns were submitted')
    }
    console.error('Assistant result received')
    const queryCalls = result.toolCalls.filter((call) => call.toolName === 'query_session_attachment')
    const expectedAnswerPassed = (testCase.expectedAnswerIncludes ?? []).every((value) =>
      result.answer.toLowerCase().includes(String(value).toLowerCase())
    )
    const toolUsePassed = testCase.shouldQuery ? queryCalls.length > 0 : queryCalls.length === 0
    const passed = toolUsePassed && (!testCase.shouldQuery || expectedAnswerPassed)

    const report = {
      id: testCase.id,
      userDataDir,
      sessionRagDbPath,
      shouldQuery: testCase.shouldQuery,
      passed,
      checks: {
        toolUsePassed,
        expectedAnswerPassed: testCase.shouldQuery ? expectedAnswerPassed : true,
      },
      queryCalls,
      answer: result.answer,
    }

    console.log(JSON.stringify(report, null, 2))
    if (!passed) {
      process.exitCode = 1
    }
  } finally {
    await electronApp.close()
    if (!args.keepUserData) {
      await fs.rm(userDataDir, { recursive: true, force: true })
    } else {
      console.error(`Kept eval userDataDir: ${userDataDir}`)
      console.error(`Kept eval session RAG db: ${sessionRagDbPath}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
