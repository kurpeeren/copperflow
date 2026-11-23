// Pure parts of the bench: reading a stream-json transcript, reading the project's measurements, the summary table.

const SERVER_PREFIX = /^mcp__copperflow__/
const REFUSAL_CHARS = 120

function answerText(content) {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
  return ""
}

function guideTopicsOf(input) {
  const topics = []
  for (const value of [input?.topic, input?.topics, input?.items]) {
    if (typeof value === "string") topics.push(value)
    else if (Array.isArray(value)) topics.push(...value.filter((item) => typeof item === "string"))
  }
  return topics
}

/** Counts what a run did from its raw stream-json text. Values the stream does not report are null. */
export function parseTranscript(text) {
  const counts = {
    toolCalls: 0,
    callsPerTool: {},
    refused: [],
    guideCalled: false,
    guideTopics: [],
    toolAnswerChars: 0,
    turns: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    durationMs: null,
    ended: "no result",
    init: null,
  }
  const toolById = new Map()
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.type === "system" && message.subtype === "init") {
      counts.init = {
        tools: message.tools ?? [],
        mcpServers: message.mcp_servers ?? [],
        skills: message.skills ?? [],
        plugins: message.plugins ?? [],
        slashCommands: message.slash_commands ?? [],
        model: message.model ?? null,
        permissionMode: message.permissionMode ?? null,
      }
    } else if (message.type === "assistant") {
      for (const block of message.message?.content ?? []) {
        if (block?.type !== "tool_use") continue
        const tool = String(block.name ?? "").replace(SERVER_PREFIX, "")
        toolById.set(block.id, tool)
        counts.toolCalls += 1
        counts.callsPerTool[tool] = (counts.callsPerTool[tool] ?? 0) + 1
        if (tool === "guide") {
          counts.guideCalled = true
          counts.guideTopics.push(...guideTopicsOf(block.input))
        }
      }
    } else if (message.type === "user") {
      const content = message.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block?.type !== "tool_result") continue
        const answer = answerText(block.content)
        counts.toolAnswerChars += answer.length
        if (block.is_error) counts.refused.push({ tool: toolById.get(block.tool_use_id) ?? "unknown", text: answer.slice(0, REFUSAL_CHARS) })
      }
    } else if (message.type === "result") {
      counts.turns = message.num_turns ?? null
      counts.costUsd = message.total_cost_usd ?? null
      counts.durationMs = message.duration_ms ?? null
      const usage = message.usage
      if (usage) {
        counts.inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
        counts.outputTokens = usage.output_tokens ?? null
      }
      counts.ended = message.is_error || message.subtype !== "success" ? `error: ${message.subtype ?? "unknown"}` : "finished"
    }
  }
  return counts
}

const CIRCUIT_LINE = /^(\S+\.circuit\.tsx): (.*)$/
const COUNTS = /^parts (\d+), nets (\d+), unplaced (\d+), unrouted (\d+), errors (\d+), warnings (\d+)/

/** The counts per circuit from project_status; a circuit that could not be built carries its error. */
export function parseProjectStatus(text) {
  const circuits = []
  for (const line of text.split("\n")) {
    const match = CIRCUIT_LINE.exec(line)
    if (!match) continue
    const [, file, rest] = match
    const counts = COUNTS.exec(rest)
    if (!counts) {
      circuits.push({ file, error: rest })
      continue
    }
    const [parts, nets, unplaced, unrouted, errors, warnings] = counts.slice(1).map(Number)
    circuits.push({ file, parts, nets, unplaced, unrouted, errors, warnings })
  }
  return circuits
}

/** Sheet instances in a CLI summary: the part lines that carry connections. */
export function countInstances(summaryText) {
  return summaryText.split("\n").filter((line) => /^\s+\S+ <[^>]+> connections=\{\{/.test(line)).length
}

/** The board size from circuit_summary { view: "board" }, or null. */
export function parseBoardSize(text) {
  const match = /Board ([\d.]+) × ([\d.]+) mm/.exec(text)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

const cell = (value) => (value === null || value === undefined ? "n/a" : String(value))
const yesNo = (value) => (value === null || value === undefined ? "n/a" : value ? "yes" : "no")

/** The summary page for one invocation: a table row per run, then the refusals grouped by tool. */
export function summaryMarkdown(results) {
  const header =
    "| brief | model | run | ended | minutes | tool calls | refused | parts | instances | unrouted | errors | warnings | fab files | tokens in/out |"
  const rule = `|${header.split("|").slice(1, -1).map(() => "---").join("|")}|`
  const rows = results.map((r) => {
    const t = r.transcript
    const p = r.project
    const tokens = t.inputTokens === null || t.outputTokens === null ? "n/a" : `${t.inputTokens}/${t.outputTokens}`
    return `| ${[r.brief, r.model, r.run, r.ended, r.minutes === null ? "n/a" : r.minutes.toFixed(1), cell(t.toolCalls), t.refused.length, cell(p.parts), cell(p.instances), cell(p.unrouted), cell(p.errors), cell(p.warnings), yesNo(p.fabFiles), tokens].join(" | ")} |`
  })
  const byTool = new Map()
  for (const r of results) {
    for (const refusal of r.transcript.refused) {
      if (!byTool.has(refusal.tool)) byTool.set(refusal.tool, [])
      byTool.get(refusal.tool).push(`- ${r.brief} run ${r.run}: ${refusal.text.replace(/\s+/g, " ")}`)
    }
  }
  const groups = [...byTool.entries()].sort((a, b) => b[1].length - a[1].length)
  const refusals = groups.length === 0 ? ["No call was refused."] : groups.flatMap(([tool, lines]) => [`### ${tool} (${lines.length})`, ...lines, ""])
  return ["# Bench summary", "", header, rule, ...rows, "", "## Refusals", "", ...refusals, ""].join("\n")
}
