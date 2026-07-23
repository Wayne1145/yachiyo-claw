export type AgentLoopReason = 'assistant_repetition' | 'tool_repetition' | 'observation_repetition' | 'oscillation'

export interface AgentLoopWarning {
  reason: AgentLoopReason
  detail: string
}

interface CompletedStep {
  text: string
  toolCalls: string[]
  observations: string[]
  fingerprint: string
}

const HISTORY_LIMIT = 8
const REPEAT_THRESHOLD = 3
const MAX_CANONICAL_LENGTH = 12_000

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : ''
}

function canonicalize(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'string') return normalizeText(value).slice(0, MAX_CANONICAL_LENGTH)
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (typeof value !== 'object') return typeof value
  if (depth >= 8) return '[depth-limit]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item, depth + 1, seen)).join(',')}]`.slice(0, MAX_CANONICAL_LENGTH)
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${key}:${canonicalize(record[key], depth + 1, seen)}`)
    .join(',')}}`.slice(0, MAX_CANONICAL_LENGTH)
}

function asRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : []
}

function toolSignature(value: Record<string, unknown>): string {
  const name = normalizeText(value.toolName ?? value.name)
  const args = value.input ?? value.args ?? value.arguments
  return name ? `${name}:${canonicalize(args)}` : ''
}

function observationSignature(value: Record<string, unknown>): string {
  const name = normalizeText(value.toolName ?? value.name)
  const output = value.output ?? value.result ?? value.value ?? value.error
  const signature = canonicalize(output)
  return signature && signature !== 'undefined' ? `${name}:${signature}` : ''
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s+/g, ' ')
  const result = new Set<string>()
  for (let index = 0; index < compact.length - 1; index += 1) result.add(compact.slice(index, index + 2))
  return result
}

function nearEqual(left: string, right: string): boolean {
  if (!left || !right) return false
  if (left === right) return true
  if (Math.min(left.length, right.length) < 40) return false
  const leftPairs = bigrams(left)
  const rightPairs = bigrams(right)
  let intersection = 0
  for (const pair of leftPairs) if (rightPairs.has(pair)) intersection += 1
  const union = leftPairs.size + rightPairs.size - intersection
  return union > 0 && intersection / union >= 0.92
}

function repeatedTail(values: string[], compare: (left: string, right: string) => boolean = (a, b) => a === b): boolean {
  if (values.length < REPEAT_THRESHOLD) return false
  const tail = values.slice(-REPEAT_THRESHOLD)
  return Boolean(tail[0]) && tail.slice(1).every((value) => compare(tail[0], value))
}

function completedStep(result: unknown): CompletedStep {
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
  const text = normalizeText(record.text)
  const toolCalls = asRecords(record.toolCalls).map(toolSignature).filter(Boolean).sort()
  const observations = asRecords(record.toolResults).map(observationSignature).filter(Boolean).sort()
  const fingerprint = canonicalize({ text, toolCalls, observations })
  return { text, toolCalls, observations, fingerprint }
}

/** Detects stalled Agent work from completed SDK steps only; streaming deltas never enter this class. */
export class AgentLoopGuard {
  private history: CompletedStep[] = []
  private ignoredWarnings = 0
  private strategyInstruction = ''

  observeCompletedStep(result: unknown): AgentLoopWarning | null {
    const step = completedStep(result)
    this.history.push(step)
    if (this.history.length > HISTORY_LIMIT) this.history.shift()

    const warning = this.detect()
    if (warning && this.ignoredWarnings > 0) {
      this.ignoredWarnings -= 1
      return null
    }
    return warning
  }

  continueOnce(): void {
    this.ignoredWarnings = 1
  }

  changeStrategy(): void {
    this.history = this.history.slice(-1)
    this.ignoredWarnings = 0
    this.strategyInstruction =
      'Loop guard: the previous approach repeated without measurable progress. Choose a materially different strategy, tool, or parameters. Do not repeat the same action or observation unless you first explain what new information makes it useful.'
  }

  takeStrategyInstruction(): string | null {
    if (!this.strategyInstruction) return null
    const instruction = this.strategyInstruction
    this.strategyInstruction = ''
    return instruction
  }

  private detect(): AgentLoopWarning | null {
    const recent = this.history.slice(-REPEAT_THRESHOLD)
    if (recent.length === REPEAT_THRESHOLD) {
      const toolCalls = recent.map((step) => step.toolCalls.join('|'))
      const observations = recent.map((step) => step.observations.join('|'))
      if (repeatedTail(toolCalls) && repeatedTail(observations)) {
        return {
          reason: 'observation_repetition',
          detail: 'The same tool call returned the same observation three times without measurable progress.',
        }
      }
      if (repeatedTail(toolCalls)) {
        return { reason: 'tool_repetition', detail: 'The Agent requested the same tool with the same parameters three times.' }
      }
      if (repeatedTail(recent.map((step) => step.text), nearEqual)) {
        return { reason: 'assistant_repetition', detail: 'The Agent produced the same or nearly identical answer three times.' }
      }
    }

    const lastFour = this.history.slice(-4)
    if (
      lastFour.length === 4 &&
      lastFour[0].fingerprint === lastFour[2].fingerprint &&
      lastFour[1].fingerprint === lastFour[3].fingerprint &&
      lastFour[0].fingerprint !== lastFour[1].fingerprint
    ) {
      return { reason: 'oscillation', detail: 'The Agent is alternating between two completed steps without making progress.' }
    }
    return null
  }
}

export class AgentLoopStoppedError extends Error {
  constructor(public readonly warning: AgentLoopWarning) {
    super(`agent_loop_stopped:${warning.reason}`)
    this.name = 'AgentLoopStoppedError'
  }
}
