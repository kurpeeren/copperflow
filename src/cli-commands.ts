import { resolve } from "node:path"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  addMark,
  checkCircuit,
  formatCheck,
  formatHistory,
  formatSummary,
  listEntries,
  loadCircuit,
  lockParts,
  removeMark,
  undoChange,
  unlockParts,
  updateAnnotations,
  type MarkInput,
} from "./core/index.js"
import { createCopperflowServer } from "./mcp/server.js"
import { startStudio } from "./studio/server.js"
import { VERSION } from "./version.js"

export interface CliIO {
  out(text: string): void
  err(text: string): void
}

const HELP = `copperflow ${VERSION}

Usage:
  copperflow mcp                              start the MCP server on stdio
  copperflow studio [--port n]                open the visual editor at http://127.0.0.1:4777
  copperflow summary <file>                   print a circuit summary
  copperflow check <file>                     build with tscircuit and list errors and warnings
  copperflow lock <file> <part...>            lock parts so the agent cannot change them
  copperflow unlock <file> <part...>          unlock parts
  copperflow mark <file> <text> [--pcb x,y | --sch x,y]
                                              leave a note for the agent
  copperflow unmark <file> <id>               remove a note
  copperflow history [--limit n]              list recent changes
  copperflow undo [id]                        undo the newest change, or the given one

Every command accepts --root <dir> (default: the current directory).
Set COPPERFLOW_TSCI to use a tscircuit CLI that is not on the PATH.`

export interface CliOptions {
  /** The tscircuit CLI for `check` and the MCP server; defaults to $COPPERFLOW_TSCI or `tsci`. */
  buildCommand?: string[]
}

export async function runCli(args: string[], cwd: string, io: CliIO, options: CliOptions = {}): Promise<number> {
  const [rootOption, afterRoot] = takeOption(args, "--root")
  const root = resolve(cwd, rootOption ?? ".")
  const [command, ...rest] = afterRoot
  try {
    switch (command) {
      case "mcp":
        await createCopperflowServer(root, options).connect(new StdioServerTransport())
        return 0
      case "studio": {
        const [port] = takeOption(rest, "--port")
        const studio = await startStudio({
          root,
          ...(port ? { port: positiveInt(port) } : {}),
          ...(options.buildCommand ? { buildCommand: options.buildCommand } : {}),
        })
        io.out(`copperflow studio is running. Open this address (it contains a key for this session):\n${studio.openUrl}\nPress Ctrl+C to stop.`)
        return 0
      }
      case "summary":
        io.out(formatSummary(await loadCircuit(root, required(rest[0], "file"))))
        return 0
      case "check": {
        const file = required(rest[0], "file")
        const result = await checkCircuit(root, file, options.buildCommand ? { command: options.buildCommand } : {})
        io.out(formatCheck(file, result))
        return result.ok ? 0 : 1
      }
      case "lock":
      case "unlock":
        await changeLocks(root, command, rest, io)
        return 0
      case "mark":
        await mark(root, rest, io)
        return 0
      case "unmark":
        await updateAnnotations(root, required(rest[0], "file"), (a) => removeMark(a, required(rest[1], "mark id")))
        io.out(`Removed mark ${rest[1]}`)
        return 0
      case "history": {
        const [limit] = takeOption(rest, "--limit")
        io.out(formatHistory(await listEntries(root, positiveInt(limit ?? "20"))))
        return 0
      }
      case "undo": {
        const entry = await undoChange(root, { author: "human", ...(rest[0] ? { id: rest[0] } : {}) })
        io.out(`${entry.id}: ${entry.summary}`)
        return 0
      }
      case undefined:
      case "help":
      case "--help":
        io.out(HELP)
        return 0
      default:
        throw new Error(`Unknown command "${command}". Run "copperflow help".`)
    }
  } catch (error) {
    io.err(`copperflow: ${(error as Error).message}`)
    return 1
  }
}

async function changeLocks(root: string, command: "lock" | "unlock", rest: string[], io: CliIO): Promise<void> {
  const file = required(rest[0], "file")
  const parts = rest.slice(1)
  if (parts.length === 0) throw new Error(`Usage: copperflow ${command} <file> <part...>`)
  const { model } = await loadCircuit(root, file)
  await updateAnnotations(root, file, (a) =>
    command === "lock" ? lockParts(a, model, parts, new Date().toISOString()) : unlockParts(a, parts),
  )
  io.out(`${command === "lock" ? "Locked" : "Unlocked"} ${parts.join(", ")}`)
}

async function mark(root: string, rest: string[], io: CliIO): Promise<void> {
  const [pcb, withoutPcb] = takeOption(rest, "--pcb")
  const [sch, args] = takeOption(withoutPcb, "--sch")
  const file = required(args[0], "file")
  const text = required(args[1], "text")
  const position = pcb ?? sch
  const input: MarkInput = position
    ? { text, view: pcb ? "pcb" : "schematic", ...parsePosition(position) }
    : { text }
  let id = ""
  await updateAnnotations(root, file, (a) => {
    const result = addMark(a, input, new Date().toISOString())
    id = result.mark.id
    return result.annotations
  })
  io.out(`Added mark ${id}`)
}

/** Returns the value of `--name value` and the arguments without it. */
function takeOption(args: string[], name: string): [string | undefined, string[]] {
  const index = args.indexOf(name)
  if (index === -1) return [undefined, args]
  return [required(args[index + 1], `${name} value`), [...args.slice(0, index), ...args.slice(index + 2)]]
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") throw new Error(`Missing ${what}. Run "copperflow help".`)
  return value
}

function parsePosition(text: string): { x: number; y: number } {
  const [x, y] = text.split(",").map(Number)
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Position must look like 10,5 (got "${text}")`)
  }
  return { x, y }
}

function positiveInt(text: string): number {
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1) throw new Error(`--limit must be a positive whole number (got "${text}")`)
  return value
}
