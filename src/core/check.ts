import { spawn, spawnSync } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import { basename, resolve } from "node:path"
import { serialized } from "./fs-utils.js"
import { oneLine } from "./summary.js"
import { isInside, resolveCircuit, resolveInRoot } from "./workspace.js"

export interface IssueGroup {
  type: string
  count: number
  /** The first few messages of this type. */
  messages: string[]
}

export interface CheckResult {
  ok: boolean
  exitCode: number | null
  errors: IssueGroup[]
  warnings: IssueGroup[]
}

export interface CheckOptions {
  /** The tscircuit CLI and any leading arguments; defaults to $COPPERFLOW_TSCI or `tsci`. */
  command?: string[]
  timeoutMs?: number
}

interface RunResult {
  code: number | null
  output: string
  notFound: boolean
}

const DEFAULT_TIMEOUT_MS = 300_000
const EXAMPLES_PER_TYPE = 3
const MAX_TEXT = 300
const OUTPUT_TAIL_LINES = 20
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_CIRCUIT_JSON_BYTES = 200 * 1024 * 1024
const WRITTEN = /Circuit JSON written to (.+?)\s*$/m
const ANSI = /\u001b\[[0-9;]*m/g
// ASCII plus Latin letters (Turkish included). Excludes look-alikes that Windows code pages
// turn into quotes, and everything cmd.exe interprets inside double quotes.
const CMD_SAFE = /^[A-Za-z0-9_.\\/ ()+,=@~À-ɏ-]+$/
const NOT_RECOGNIZED = /is not recognized as an internal or external command/
const CMD_NOT_FOUND = 9009
const SH_NOT_FOUND = 127
const buildQueues = new Map<string, Promise<void>>()

/**
 * Builds a circuit with the tscircuit CLI and reads the errors and warnings from the
 * circuit JSON it writes: placement overlaps, unrouted ports, missing parts and so on.
 * Builds in one project run one at a time.
 */
export async function checkCircuit(root: string, file: string, options: CheckOptions = {}): Promise<CheckResult> {
  const circuit = await resolveCircuit(root, file)
  const [command = "tsci", ...prefix] = options.command ?? [process.env.COPPERFLOW_TSCI || "tsci"]
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // "./" keeps a file name that starts with "-" from being read as an option.
  const args = [...prefix, "build", `./${circuit.file}`]
  const run = await serialized(buildQueues, resolve(root), () => runProcess(command, args, resolve(root), timeoutMs))
  const output = hideRoot(run.output, [resolve(root), await realpath(resolve(root))])
  const written = WRITTEN.exec(output)?.[1]
  if (!written) {
    if (run.notFound) {
      throw new Error("The tscircuit CLI (tsci) was not found. Install it with npm install -g tscircuit, or set COPPERFLOW_TSCI to its path.")
    }
    throw new Error(`The build did not produce circuit JSON (exit code ${run.code}). Last output:\n${tail(output)}`)
  }
  const elements = await readCircuitJson(root, written)
  const errors = groupIssues(elements, "_error")
  return { ok: run.code === 0 && errors.length === 0, exitCode: run.code, errors, warnings: groupIssues(elements, "_warning") }
}

export function formatCheck(file: string, result: CheckResult): string {
  const total = (groups: IssueGroup[]) => groups.reduce((sum, g) => sum + g.count, 0)
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const lines = [
    `${file}: build ${result.ok ? "passed" : "failed"}, ${plural(total(result.errors), "error")}, ${plural(total(result.warnings), "warning")}`,
  ]
  for (const [title, groups] of [
    ["Errors:", result.errors],
    ["Warnings:", result.warnings],
  ] as const) {
    if (groups.length === 0) continue
    lines.push(title)
    for (const g of groups) {
      const more = g.count > g.messages.length ? ` | and ${g.count - g.messages.length} more` : ""
      lines.push(`  ${g.type}${g.count > 1 ? ` (${g.count})` : ""}: ${g.messages.join(" | ")}${more}`)
    }
  }
  if (!result.ok && result.errors.length === 0) {
    lines.push(`The build exited with code ${result.exitCode}; run tsci build ${file} for details.`)
  }
  return lines.join("\n")
}

/** Quotes one argument for cmd.exe, refusing characters it would interpret even inside quotes. */
export function quoteForCmd(arg: string): string {
  const colon = arg.indexOf(":")
  const safe = CMD_SAFE.test(arg.replace(/^[A-Za-z]:/, "")) && (colon === -1 || colon === 1) && !arg.endsWith("\\")
  if (!safe) throw new Error("A path or command contains special characters that cannot be passed to the build safely")
  return `"${arg}"`
}

async function readCircuitJson(root: string, written: string): Promise<unknown[]> {
  const unexpected = new Error("The build reported an unexpected circuit JSON path")
  let path: string
  try {
    path = await realpath(resolveInRoot(root, written))
  } catch {
    throw unexpected
  }
  if (basename(path) !== "circuit.json" || !isInside(await realpath(resolve(root)), path)) throw unexpected
  if ((await stat(path)).size > MAX_CIRCUIT_JSON_BYTES) throw new Error("The circuit JSON is too large to read")
  try {
    const elements: unknown = JSON.parse(await readFile(path, "utf8"))
    if (Array.isArray(elements)) return elements
  } catch {
    // fall through to the generic message, which does not quote the file
  }
  throw new Error("The build wrote a file that is not valid circuit JSON")
}

function groupIssues(elements: unknown[], suffix: string): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  for (const element of elements) {
    const { type, message } = (element ?? {}) as { type?: unknown; message?: unknown }
    if (typeof type !== "string" || !type.endsWith(suffix)) continue
    const key = clip(type)
    const previous = groups.get(key) ?? { type: key, count: 0, messages: [] }
    const text = clip(typeof message === "string" ? message : "(no message)")
    const messages = previous.messages.length < EXAMPLES_PER_TYPE ? [...previous.messages, text] : previous.messages
    groups.set(key, { type: key, count: previous.count + 1, messages })
  }
  return [...groups.values()]
}

/** Runs the build; on Windows through cmd.exe, because the CLI is installed as a .cmd shim. */
function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((done, fail) => {
    const windows = process.platform === "win32"
    const child = windows
      ? spawn([command, ...args].map(quoteForCmd).join(" "), {
          cwd,
          shell: true,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
          // Stops cmd.exe from running a tsci.cmd planted in the project folder.
          env: { ...process.env, NoDefaultCurrentDirectoryInExePath: "1" },
        })
      : spawn(command, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-MAX_OUTPUT_BYTES)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    const timer = setTimeout(() => {
      killTree(child.pid)
      fail(new Error(`The build took longer than ${timeoutMs / 1000} s and was stopped`))
    }, timeoutMs)
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (error.code === "ENOENT") done({ code: null, output, notFound: true })
      else fail(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const clean = output.replace(ANSI, "")
      const notFound = code === SH_NOT_FOUND || code === CMD_NOT_FOUND || NOT_RECOGNIZED.test(clean)
      done({ code, output: clean, notFound })
    })
  })
}

/** Stops the build and everything it started (cmd.exe alone would leave tsci running). */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
    return
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    // the process group already exited
  }
}

/** Replaces the project's absolute path with "." so build output does not reveal it. */
function hideRoot(text: string, roots: string[]): string {
  return roots.reduce((current, root) => current.split(root).join("."), text)
}

function clip(text: string): string {
  const flat = oneLine(text)
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT)}…` : flat
}

function tail(output: string): string {
  return output
    .trimEnd()
    .split(/\r?\n/)
    .slice(-OUTPUT_TAIL_LINES)
    .map(clip)
    .join("\n")
}
