#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'

function parseArgs(argv) {
  const args = {
    fixturesRepo: '../../chatbox-session-rag-eval-fixtures',
    caseId: undefined,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--fixtures-repo') {
      args.fixturesRepo = argv[++i]
    } else if (arg === '--case') {
      args.caseId = argv[++i]
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function loadCases(fixturesRepo, caseId) {
  const casesPath = path.join(fixturesRepo, 'cases', 'session-attachment-rag-cases.json')
  const cases = await readJson(casesPath)
  const selectedCases = caseId ? cases.filter((item) => item.id === caseId) : cases
  if (selectedCases.length === 0) {
    throw new Error(`No eval cases found${caseId ? ` for ${caseId}` : ''}`)
  }

  return Promise.all(
    selectedCases.map(async (item) => ({
      ...item,
      attachments: await Promise.all(
        item.attachments.map(async (attachment, index) => ({
          id: attachment.id ?? index + 1,
          filename: attachment.filename,
          text: await fs.readFile(path.join(fixturesRepo, attachment.path), 'utf8'),
        }))
      ),
    }))
  )
}

function buildSystemPrompt(testCase) {
  const readyFiles = testCase.attachments.map((attachment) => `- "${attachment.filename}"`).join('\n')
  return `
You are testing session attachment RAG behavior.

Large uploaded files are available through retrieval tools instead of full inline context.
The user message contains <ATTACHMENT_FILE> tags with <RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>.
Treat those tags as real uploaded files. Their full content is not in the prompt.

Ready files:
${readyFiles}

Tools:
- list_session_attachments: list current large attachments.
- query_session_attachment: semantic search across ready large attachments.
- read_session_attachment_parents: read parent blocks returned by search.

Guidance:
- If the user asks about a ready uploaded file, call query_session_attachment before answering.
- Rewrite the user's question into a focused semantic query, using prior context if needed.
- Do not call retrieval tools when the user question is clearly unrelated to the uploaded files.
- If retrieved excerpts are insufficient, say so.
`.trim()
}

function buildAttachmentTags(testCase) {
  const systemReminder = [
    'This uploaded file is indexed for retrieval, not inlined in the conversation. ',
    'For document-specific questions about this file, use query_session_attachment and then ',
    'read_session_attachment_parents before answering. If the user asks something unrelated to the uploaded file, ',
    'answer normally without retrieval.',
  ].join('')
  return testCase.attachments
    .map(
      (attachment, index) => `
<ATTACHMENT_FILE>
<FILE_INDEX>${index + 1}</FILE_INDEX>
<FILE_NAME>${attachment.filename}</FILE_NAME>
<FILE_KEY>session-attachment:${attachment.id}</FILE_KEY>
<FILE_CONTENT>
</FILE_CONTENT>
<RETRIEVAL_MODE>session_attachment_rag</RETRIEVAL_MODE>
<INDEX_STATUS>ready</INDEX_STATUS>
<SYSTEM_REMINDER>${systemReminder}</SYSTEM_REMINDER>
</ATTACHMENT_FILE>`.trim()
    )
    .join('\n\n')
}

function buildUserPrompt(testCase) {
  const user = getTurns(testCase).at(-1)?.user ?? testCase.user
  return `${user}\n\n${buildAttachmentTags(testCase)}`
}

function getTurns(testCase) {
  if (!Array.isArray(testCase.turns) || testCase.turns.length === 0) {
    return [{ user: testCase.user }]
  }
  return testCase.turns.map((turn) => (typeof turn === 'string' ? { user: turn } : turn))
}

function buildMessages(testCase) {
  const turns = getTurns(testCase)
  if (turns.length <= 1) {
    return undefined
  }
  const attachmentTags = buildAttachmentTags(testCase)
  return turns.flatMap((turn, index) => {
    const userContent = index === 0 ? `${turn.user}\n\n${attachmentTags}` : turn.user
    const messages = [{ role: 'user', content: userContent }]
    if (index < turns.length - 1) {
      messages.push({ role: 'assistant', content: turn.assistant || 'Understood.' })
    }
    return messages
  })
}

function scoreText(text, query) {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((term) => term.length > 2)
  const haystack = text.toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function makeSnippet(attachment, query, parentId) {
  const paragraphs = attachment.text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const best = paragraphs
    .map((paragraph) => ({ paragraph, score: scoreText(paragraph, query) }))
    .sort((a, b) => b.score - a.score)[0]?.paragraph

  return {
    attachmentId: attachment.id,
    parentId,
    filename: attachment.filename,
    sectionPath: undefined,
    chunkOrder: 0,
    text: best || attachment.text.slice(0, 1200),
    score: best ? 0.86 : 0.3,
  }
}

async function runCase(testCase, model) {
  const calls = []
  const parentBlocks = new Map()

  const tools = {
    list_session_attachments: tool({
      description: 'List large uploaded attachments in the current session and show their readiness status.',
      inputSchema: z.object({}),
      execute: async () => {
        calls.push({ name: 'list_session_attachments', input: {} })
        return testCase.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          status: 'ready',
          indexStatus: 'ready',
        }))
      },
    }),
    query_session_attachment: tool({
      description: 'Search across ready large uploaded attachments with a semantic query.',
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(12).optional(),
      }),
      execute: async (input) => {
        calls.push({ name: 'query_session_attachment', input })
        const ranked = testCase.attachments
          .map((attachment, index) => makeSnippet(attachment, input.query, index + 1))
          .sort((a, b) => b.score - a.score)
          .slice(0, input.limit ?? 4)
        for (const hit of ranked) {
          parentBlocks.set(hit.parentId, {
            id: hit.parentId,
            attachmentId: hit.attachmentId,
            filename: hit.filename,
            text: hit.text,
          })
        }
        return ranked
      },
    }),
    read_session_attachment_parents: tool({
      description: 'Read parent blocks for search hits from large uploaded attachments.',
      inputSchema: z.object({
        parentIds: z.array(z.number()),
      }),
      execute: async (input) => {
        calls.push({ name: 'read_session_attachment_parents', input })
        return input.parentIds.map((id) => parentBlocks.get(id)).filter(Boolean)
      },
    }),
  }

  const messages = buildMessages(testCase)
  const result = await generateText({
    model,
    system: buildSystemPrompt(testCase),
    ...(messages ? { messages } : { prompt: buildUserPrompt(testCase) }),
    tools,
    stopWhen: stepCountIs(4),
    temperature: 0,
  })

  const queryCalls = calls.filter((call) => call.name === 'query_session_attachment')
  const answer = result.text || ''
  const expectedAnswerPassed = (testCase.expectedAnswerIncludes ?? []).every((value) =>
    answer.toLowerCase().includes(String(value).toLowerCase())
  )
  const toolUsePassed = testCase.shouldQuery ? queryCalls.length > 0 : queryCalls.length === 0

  return {
    id: testCase.id,
    shouldQuery: testCase.shouldQuery,
    queryCalls,
    answer,
    passed: toolUsePassed && (!testCase.shouldQuery || expectedAnswerPassed),
    checks: {
      toolUsePassed,
      expectedAnswerPassed: testCase.shouldQuery ? expectedAnswerPassed : true,
    },
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const fixturesRepo = path.resolve(process.cwd(), args.fixturesRepo)
  const cases = await loadCases(fixturesRepo, args.caseId)

  if (args.dryRun) {
    console.log(
      JSON.stringify({ fixturesRepo, caseCount: cases.length, caseIds: cases.map((item) => item.id) }, null, 2)
    )
    return
  }

  const baseURL = process.env.CHATBOX_EVAL_BASE_URL
  const apiKey = process.env.CHATBOX_EVAL_API_KEY || process.env.CHATBOX_LICENSE_KEY
  const modelId = process.env.CHATBOX_EVAL_MODEL
  if (!baseURL || !apiKey || !modelId) {
    throw new Error('Set CHATBOX_EVAL_BASE_URL, CHATBOX_EVAL_MODEL, and CHATBOX_EVAL_API_KEY or CHATBOX_LICENSE_KEY.')
  }

  const provider = createOpenAICompatible({
    name: 'session-rag-eval',
    baseURL,
    apiKey,
  })
  const model = provider.languageModel(modelId)

  const results = []
  for (const testCase of cases) {
    const result = await runCase(testCase, model)
    results.push(result)
    console.log(JSON.stringify(result))
  }

  const passed = results.filter((result) => result.passed).length
  console.error(`Session RAG eval: ${passed}/${results.length} passed`)
  if (passed !== results.length) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
