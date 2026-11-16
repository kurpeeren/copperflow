export interface Refusal {
  tool: string
  text: string
}

export interface TranscriptCounts {
  toolCalls: number
  callsPerTool: Record<string, number>
  refused: Refusal[]
  guideCalled: boolean
  guideTopics: string[]
  toolAnswerChars: number
  turns: number | null
  inputTokens: number | null
  outputTokens: number | null
  costUsd: number | null
  durationMs: number | null
  ended: string
  init: {
    tools: string[]
    mcpServers: unknown[]
    skills: unknown[]
    plugins: unknown[]
    slashCommands: unknown[]
    model: string | null
    permissionMode: string | null
  } | null
}

export interface CircuitCounts {
  file: string
  parts?: number
  nets?: number
  unplaced?: number
  unrouted?: number
  errors?: number
  warnings?: number
  error?: string
}

export interface RunResult {
  brief: string
  model: string
  run: number
  ended: string
  minutes: number | null
  transcript: Pick<TranscriptCounts, "toolCalls" | "refused" | "inputTokens" | "outputTokens"> & Partial<TranscriptCounts>
  project: {
    parts: number | null
    instances: number | null
    unrouted: number | null
    errors: number | null
    warnings: number | null
    fabFiles: boolean | null
    [key: string]: unknown
  }
}

export function parseTranscript(text: string): TranscriptCounts
export function parseProjectStatus(text: string): CircuitCounts[]
export function countInstances(summaryText: string): number
export function parseBoardSize(text: string): { width: number; height: number } | null
export function summaryMarkdown(results: RunResult[]): string
