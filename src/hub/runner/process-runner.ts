// The process runner: each workspace is a `copperflow workspace` child process on free loopback ports.
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { TICKET_PUBLIC_KEY_ENV } from "../../hosted/ticket.js"
import { ManagedRunner, type Launched, type Launcher, type WorkspaceAddress, type WorkspaceSpec } from "./runner.js"

/**
 * NOT A SECURITY BOUNDARY. A workspace started by this runner is an ordinary child process of the hub, running as the
 * hub's operating-system user: circuit code that escapes the engine's `node:vm` guard can read and write anything that
 * user can, including other users' projects and the hub's data directory. Use it for tests and for accounts you trust
 * (yourself); give untrusted people the container runner (Task 3), which keeps each workspace in its own container.
 *
 * What it does keep: the child's environment holds only the hub's PUBLIC ticket key (plus, on Windows, SYSTEMROOT,
 * without which the child cannot open a socket); the workspace id and public origin travel on its command line; it
 * listens on loopback only; and it stops when the hub's end of its standard input closes, so a crashed hub leaves no
 * workspace behind.
 */
export interface ProcessRunnerOptions {
  /** The hub's ticket PUBLIC key as base64 of its raw 32 bytes (never the private key). */
  ticketPublicKey: string
  /** The program and leading arguments that run the CLI; default this Node and the built dist/cli.js. */
  command?: readonly string[]
  /** How long a workspace may take to print its address; default 30 s. */
  startTimeoutMs?: number
  idleMs?: number
  maxRunning?: number
  log?: (line: string) => void
}

const DEFAULT_START_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 5_000
const MAX_FIRST_LINE = 4096
const PRIVATE_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

function defaultCommand(): string[] {
  return [process.execPath, fileURLToPath(new URL("../../cli.js", import.meta.url))]
}

/** The child's whole environment: the public key and nothing else worth stealing. */
export function workspaceEnvironment(ticketPublicKey: string, platform = process.platform, systemRoot = process.env.SYSTEMROOT): Record<string, string> {
  const env: Record<string, string> = { [TICKET_PUBLIC_KEY_ENV]: ticketPublicKey }
  if (platform === "win32" && systemRoot) env.SYSTEMROOT = systemRoot
  return env
}

function parseAddress(line: string): WorkspaceAddress {
  const value = JSON.parse(line) as unknown
  const { studio, mcp } = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>
  if (typeof studio !== "string" || typeof mcp !== "string" || !PRIVATE_ORIGIN.test(studio) || !PRIVATE_ORIGIN.test(mcp)) {
    throw new Error("the workspace printed an unexpected address")
  }
  return { studio, mcp }
}

/** Starts `copperflow workspace` for a spec and waits for its address line. */
export function processLauncher(options: ProcessRunnerOptions): Launcher {
  const command = options.command ?? defaultCommand()
  const timeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  return (spec: WorkspaceSpec) =>
    new Promise<Launched>((done, fail) => {
      const args = [
        ...command.slice(1),
        "workspace",
        "--root", spec.projectDir,
        "--id", spec.id,
        "--public-origin", spec.publicOrigin,
        "--base-path", spec.basePath === "" ? "/" : spec.basePath,
        "--studio-port", "0",
        "--mcp-port", "0",
        "--bind", "127.0.0.1",
        "--stop-on-stdin-end",
      ]
      const child = spawn(command[0] as string, args, { cwd: spec.projectDir, env: workspaceEnvironment(options.ticketPublicKey), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false })
      const exited = new Promise<void>((ended) => child.once("exit", () => ended()))
      let settled = false
      let stdout = ""
      const finish = (error?: Error, address?: WorkspaceAddress) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error || !address) {
          child.kill("SIGKILL")
          fail(error ?? new Error("no address"))
          return
        }
        done({ address, exited, stop: () => stopChild() })
      }
      let stopping: Promise<void> | undefined
      const stopChild = () => {
        stopping ??= (async () => {
          if (child.exitCode !== null || child.signalCode !== null) return
          child.stdin.end()
          child.kill("SIGTERM")
          const killer = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS)
          await exited
          clearTimeout(killer)
        })()
        return stopping
      }
      const timer = setTimeout(() => finish(new Error(`no address within ${timeoutMs} ms`)), timeoutMs)
      child.once("error", (error) => finish(error))
      child.once("exit", (code) => finish(new Error(`exited with code ${code} before it listened`)))
      // The stream is kept open for the child's --stop-on-stdin-end; its errors only mean the child went away.
      child.stdin.on("error", () => undefined)
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk: string) => {
        if (settled) return
        stdout += chunk
        const end = stdout.indexOf("\n")
        if (end < 0) {
          if (stdout.length > MAX_FIRST_LINE) finish(new Error("the workspace's first line is too long"))
          return
        }
        try {
          finish(undefined, parseAddress(stdout.slice(0, end)))
        } catch (error) {
          finish(error as Error)
        }
      })
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) if (line.trim() !== "") log(`workspace ${spec.id}: ${line.slice(0, 500)}`)
      })
    })
}

/**
 * A runner of child processes. NOT A SECURITY BOUNDARY: for tests and trusted accounts only; see ProcessRunnerOptions
 * for what it does and does not protect.
 */
export function createProcessRunner(options: ProcessRunnerOptions): ManagedRunner {
  return new ManagedRunner({
    launch: processLauncher(options),
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
    ...(options.maxRunning !== undefined ? { maxRunning: options.maxRunning } : {}),
    ...(options.log ? { log: options.log } : {}),
  })
}
