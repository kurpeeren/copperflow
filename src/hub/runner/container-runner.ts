// The container runner: each workspace is `copperflow workspace` in a container of its own, the hosted service's
// security boundary (docs/hosted.md, "Running the hub"). Every engine command is an argument array given to `spawn`
// without a shell; nothing in it is taken from user text: the project id is checked against the id the store
// generates, the project folder and public origin are the hub's own, and every other value is a checked option.
import { spawn as nodeSpawn } from "node:child_process"
import type { Readable, Writable } from "node:stream"
import { TICKET_PUBLIC_KEY_ENV } from "../../hosted/ticket.js"
import { ID_PATTERN } from "../secrets.js"
import { ManagedRunner, type Launched, type Launcher, type WorkspaceAddress, type WorkspaceSpec } from "./runner.js"

/** How the hub reaches a workspace container. */
export type ContainerReach =
  /** The hub runs in a container on the workspace network and reaches each workspace by its container name. */
  | "network"
  /** The hub runs on the host and reaches each workspace through ports published on 127.0.0.1 only. */
  | "loopback"

export interface ContainerLimits {
  /** --memory and --memory-swap (no swap beyond the memory), such as 512m. */
  memory: string
  /** --cpus, such as 1 or 0.5. */
  cpus: string
  /** --pids-limit. */
  pids: number
  /** --ulimit nofile=<n>:<n>. */
  openFiles: number
  /** The size of the /tmp tmpfs, such as 64m. */
  tmpSize: string
}

export const DEFAULT_LIMITS: ContainerLimits = { memory: "512m", cpus: "1", pids: 128, openFiles: 1024, tmpSize: "64m" }
export const DEFAULT_CONTAINER_COMMAND = "docker"
/** The ports the two servers listen on inside every container. */
export const STUDIO_PORT = 8080
export const MCP_PORT = 8081
/** The uid and gid the image's user has, and every container runs as. */
export const WORKSPACE_USER = "10001:10001"
/** Containers are named this followed by the project id; the leftover sweep removes only names of this shape. */
export const CONTAINER_PREFIX = "cf-ws-"
/** The label every workspace container carries, so the sweep never touches another program's containers. */
export const CONTAINER_LABEL = "org.copperflow.workspace=1"

const DEFAULT_START_TIMEOUT_MS = 60_000
const COMMAND_TIMEOUT_MS = 30_000
const STOP_SECONDS = 5
const MAX_FIRST_LINE = 4096
const DEFAULT_LOG_CAP_BYTES = 64 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024

const SIZE = /^[1-9][0-9]{0,5}[kmg]$/
const CPUS = /^(0\.[0-9]{1,2}|[1-9][0-9]?(\.[0-9]{1,2})?)$/
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/
const IMAGE_NAME = /^[a-z0-9][a-z0-9._/:@-]{0,254}$/
const PUBLIC_ORIGIN = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/
const PUBLIC_KEY = /^[A-Za-z0-9+/]{43}=$/
const LOOPBACK_PORT = /^127\.0\.0\.1:([0-9]{1,5})$/

/** What a spawned engine command must offer: a ChildProcess fits, and so does a test's fake. */
export interface ChildLike {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  once(event: "exit", listener: (code: number | null) => void): unknown
  once(event: "error", listener: (error: Error) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export type SpawnLike = (command: string, args: string[], options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"]; windowsHide: true; shell: false }) => ChildLike

export interface ContainerSettings {
  /** The workspace image, such as copperflow-workspace or registry/copperflow-workspace@sha256:... */
  image: string
  /** The engine's command line: docker (default) or podman, by name or path. */
  command?: string
  /**
   * With network reach: the hub's own container, connected to each workspace's network for the workspace's life.
   * Every workspace has a network of its own (named like its container, created --internal), so two never share one.
   */
  hubContainer?: string
  /** How the hub reaches containers; default loopback (the hub on the host). */
  reach?: ContainerReach
  limits?: Partial<ContainerLimits>
}

export interface ContainerRunnerOptions extends ContainerSettings {
  /** The hub's ticket PUBLIC key as base64 of its raw 32 bytes (never the private key). */
  ticketPublicKey: string
  /** How long a container may take to print its address; default 60 s. */
  startTimeoutMs?: number
  /** The most bytes of one workspace's standard error copied to the log; default 64 KiB. */
  logCapBytes?: number
  idleMs?: number
  maxRunning?: number
  log?: (line: string) => void
  /** Tests swap the engine command. */
  spawn?: SpawnLike
}

interface Checked {
  command: string
  image: string
  hubContainer: string | undefined
  reach: ContainerReach
  limits: ContainerLimits
}

/** Checks every setting; each one ends up in an argument array, so each is held to a strict shape. */
export function checkSettings(settings: ContainerSettings): Checked {
  const command = settings.command ?? DEFAULT_CONTAINER_COMMAND
  if (command === "" || command.startsWith("-") || /[\0\r\n]/.test(command)) throw new Error("--container-command must be docker, podman or the path to one of them")
  const image = settings.image
  if (!IMAGE_NAME.test(image) || image.includes("..")) throw new Error("--workspace-image must be an image name, such as copperflow-workspace")
  const reach = settings.reach ?? "loopback"
  if (reach !== "network" && reach !== "loopback") throw new Error("--workspace-reach must be network or loopback")
  const hubContainer = settings.hubContainer
  if (reach === "network" && hubContainer === undefined) throw new Error("--workspace-reach network needs --hub-container <name>: the hub's own container, joined to each workspace's network")
  if (reach === "loopback" && hubContainer !== undefined) throw new Error("--hub-container belongs to --workspace-reach network")
  if (hubContainer !== undefined && (!CONTAINER_NAME.test(hubContainer) || hubContainer.startsWith(CONTAINER_PREFIX))) throw new Error("--hub-container must be a container name")
  const limits = { ...DEFAULT_LIMITS, ...(settings.limits ?? {}) }
  if (!SIZE.test(limits.memory) || !SIZE.test(limits.tmpSize)) throw new Error("memory sizes must be a number and k, m or g, such as 512m")
  if (!CPUS.test(limits.cpus)) throw new Error("--cpus must be a number such as 1 or 0.5")
  if (!Number.isInteger(limits.pids) || limits.pids < 16 || limits.pids > 4096) throw new Error("the pids limit must be a whole number from 16 to 4096")
  if (!Number.isInteger(limits.openFiles) || limits.openFiles < 64 || limits.openFiles > 65_536) throw new Error("the open-files limit must be a whole number from 64 to 65536")
  return { command, image, hubContainer, reach, limits }
}

export function containerName(projectId: string): string {
  if (!ID_PATTERN.test(projectId)) throw new Error("refused: the workspace id is not a project id")
  return `${CONTAINER_PREFIX}${projectId}`
}

/**
 * The whole `docker run` argument array for one workspace. Nothing else is mounted, published or passed: one bind
 * mount (the project folder at /work), one environment variable (the public ticket key), the internal network, and
 * with loopback reach two ports published on 127.0.0.1 only.
 */
export function containerRunArgs(spec: WorkspaceSpec, settings: ContainerSettings, ticketPublicKey: string): string[] {
  const checked = checkSettings(settings)
  const name = containerName(spec.id)
  // The folder is the hub's own (data dir + generated ids), but it is still checked: --mount splits on commas.
  if (!/^(\/|[A-Za-z]:[\\/])/.test(spec.projectDir) || /[,\0\r\n"]/.test(spec.projectDir)) throw new Error("refused: the project folder is not a plain absolute path")
  if (!PUBLIC_ORIGIN.test(spec.publicOrigin)) throw new Error("refused: the workspace origin is not a plain origin")
  if (spec.basePath !== "") throw new Error("refused: the container runner serves workspaces on their own origin only")
  if (!PUBLIC_KEY.test(ticketPublicKey)) throw new Error("refused: the ticket public key is not base64 of 32 bytes")
  const { limits } = checked
  const publish = checked.reach === "loopback" ? ["--publish", `127.0.0.1::${STUDIO_PORT}`, "--publish", `127.0.0.1::${MCP_PORT}`] : []
  return [
    "run",
    "--rm",
    "--interactive",
    "--name", name,
    "--label", CONTAINER_LABEL,
    "--user", WORKSPACE_USER,
    "--read-only",
    "--tmpfs", `/tmp:rw,noexec,nosuid,size=${limits.tmpSize}`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", String(limits.pids),
    "--memory", limits.memory,
    "--memory-swap", limits.memory,
    "--cpus", limits.cpus,
    "--ulimit", `nofile=${limits.openFiles}:${limits.openFiles}`,
    // The workspace's own network (see workspaceNetworkArgs), named like its container.
    "--network", name,
    ...publish,
    "--mount", `type=bind,source=${spec.projectDir},target=/work`,
    "--workdir", "/work",
    "--env", `${TICKET_PUBLIC_KEY_ENV}=${ticketPublicKey}`,
    checked.image,
    "--root", "/work",
    "--id", spec.id,
    "--public-origin", spec.publicOrigin,
    "--base-path", "/",
    "--studio-port", String(STUDIO_PORT),
    "--mcp-port", String(MCP_PORT),
    "--bind", "0.0.0.0",
    "--stop-on-stdin-end",
  ]
}

/** The engine command's own environment: the hub's, so it finds its socket and config. None of it enters a container. */
function clientEnv(): NodeJS.ProcessEnv {
  return { ...process.env }
}

function defaultSpawn(): SpawnLike {
  return (command, args, options) => nodeSpawn(command, args, options)
}

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Runs one short engine command and collects its output (capped), failing after a timeout. */
export function runEngine(spawn: SpawnLike, command: string, args: string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((done, fail) => {
    let child: ChildLike
    try {
      child = spawn(command, args, { env: clientEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false })
    } catch (error) {
      fail(error as Error)
      return
    }
    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      fail(new Error(`${command} ${args[0] ?? ""} did not finish within ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdin.on("error", () => undefined)
    child.stdin.end()
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk
    })
    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fail(error)
    })
    child.once("exit", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // Let the last chunks arrive before answering.
      setImmediate(() => done({ code, stdout: stdout.slice(0, MAX_OUTPUT_BYTES), stderr: stderr.slice(0, MAX_OUTPUT_BYTES) }))
    })
  })
}

const BUILD_HINT = "Build it from the repository with: docker build -f deploy/workspace.Dockerfile -t copperflow-workspace ."

/**
 * What the hub checks before it starts with the container runner: the engine answers, the image is there, and it can
 * create and remove an internal network (each workspace gets one). Throws a message that says what to do.
 */
export async function checkEngine(settings: ContainerSettings, spawn: SpawnLike = defaultSpawn()): Promise<void> {
  const { command, image } = checkSettings(settings)
  const version = await runEngine(spawn, command, ["version", "--format", "{{.Server.Version}}"]).catch((error: Error) => ({ code: -1, stdout: "", stderr: error.message }))
  if (version.code !== 0) throw new Error(`The container engine does not answer (\`${command} version\` failed). Start it, and make sure the user the hub runs as may use it.`)
  const found = await runEngine(spawn, command, ["image", "inspect", "--format", "{{.Id}}", image])
  if (found.code !== 0) throw new Error(`The workspace image ${image} is missing. ${BUILD_HINT}`)
  const probe = `cf-check-${process.pid}`
  const made = await runEngine(spawn, command, networkCreateArgs(probe))
  if (made.code !== 0) throw new Error(`The hub could not create an internal network (${command} network create --internal): ${made.stderr.trim().slice(0, 300)}`)
  const removed = await runEngine(spawn, command, ["network", "rm", probe])
  if (removed.code !== 0) throw new Error(`The hub could not remove the network ${probe} it made: ${removed.stderr.trim().slice(0, 300)}`)
}

/** `network create` for one workspace's own network: internal (no route out), bridge, labelled for the sweep. */
export function networkCreateArgs(name: string): string[] {
  return ["network", "create", "--internal", "--driver", "bridge", "--label", CONTAINER_LABEL, name]
}

/** Names of exactly our shape from an engine listing; anything else is ignored, never passed on. */
function ourNames(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => name.startsWith(CONTAINER_PREFIX) && ID_PATTERN.test(name.slice(CONTAINER_PREFIX.length)))
}

/** Removes every workspace container and network a previous run of the hub left behind; how many containers it removed. */
export async function sweepLeftovers(settings: ContainerSettings, spawn: SpawnLike = defaultSpawn(), log: (line: string) => void = () => undefined): Promise<number> {
  const { command } = checkSettings(settings)
  const listed = await runEngine(spawn, command, ["ps", "--all", "--filter", `label=${CONTAINER_LABEL}`, "--filter", `name=^${CONTAINER_PREFIX}`, "--format", "{{.Names}}"])
  if (listed.code !== 0) throw new Error(`Could not list leftover workspace containers: ${listed.stderr.trim().slice(0, 300)}`)
  let removed = 0
  for (const name of ourNames(listed.stdout)) {
    const result = await runEngine(spawn, command, ["rm", "--force", name])
    if (result.code === 0) removed += 1
    else log(`could not remove leftover container ${name}: ${result.stderr.trim().slice(0, 200)}`)
  }
  const networks = await runEngine(spawn, command, ["network", "ls", "--filter", `label=${CONTAINER_LABEL}`, "--format", "{{.Name}}"])
  if (networks.code !== 0) throw new Error(`Could not list leftover workspace networks: ${networks.stderr.trim().slice(0, 300)}`)
  for (const name of ourNames(networks.stdout)) {
    const result = await runEngine(spawn, command, ["network", "rm", name])
    if (result.code !== 0) log(`could not remove leftover network ${name}: ${result.stderr.trim().slice(0, 200)}`)
  }
  return removed
}

/** Creates the workspace's own network (removing a leftover of the same name first) and joins the hub to it. */
async function openNetwork(checked: Checked, name: string, spawn: SpawnLike): Promise<void> {
  await runEngine(spawn, checked.command, ["network", "rm", name]).catch(() => undefined)
  const made = await runEngine(spawn, checked.command, networkCreateArgs(name))
  if (made.code !== 0) throw new Error(`the workspace network could not be created: ${made.stderr.trim().slice(0, 200)}`)
  if (checked.hubContainer === undefined) return
  const joined = await runEngine(spawn, checked.command, ["network", "connect", name, checked.hubContainer])
  if (joined.code !== 0) {
    await closeNetwork(checked, name, spawn)
    throw new Error(`the hub could not join the workspace network: ${joined.stderr.trim().slice(0, 200)}`)
  }
}

/** Takes the hub off the workspace's network and removes it; failures only mean it is gone already. */
async function closeNetwork(checked: Checked, name: string, spawn: SpawnLike): Promise<void> {
  if (checked.hubContainer !== undefined) await runEngine(spawn, checked.command, ["network", "disconnect", "--force", name, checked.hubContainer]).catch(() => undefined)
  await runEngine(spawn, checked.command, ["network", "rm", name]).catch(() => undefined)
}

const READY = { studio: `http://0.0.0.0:${STUDIO_PORT}`, mcp: `http://0.0.0.0:${MCP_PORT}` }

/** The container's first line must name exactly the two fixed ports on 0.0.0.0. */
function checkReadyLine(line: string): void {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error("the workspace printed an unexpected first line")
  }
  const { studio, mcp } = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>
  if (studio !== READY.studio || mcp !== READY.mcp) throw new Error("the workspace printed an unexpected address")
}

/** Where the hub reaches a ready container. */
async function addressOf(checked: Checked, name: string, spawn: SpawnLike): Promise<WorkspaceAddress> {
  if (checked.reach === "network") return { studio: `http://${name}:${STUDIO_PORT}`, mcp: `http://${name}:${MCP_PORT}` }
  const port = async (inner: number) => {
    const result = await runEngine(spawn, checked.command, ["port", name, `${inner}/tcp`])
    const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("127.0.0.1:"))
    const match = result.code === 0 && first ? LOOPBACK_PORT.exec(first) : null
    const value = match ? Number(match[1]) : NaN
    if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`the published port of ${inner} is not on 127.0.0.1`)
    return value
  }
  return { studio: `http://127.0.0.1:${await port(STUDIO_PORT)}`, mcp: `http://127.0.0.1:${await port(MCP_PORT)}` }
}

/** Stops a container: `stop -t 5`, then `rm --force` (which fails harmlessly when --rm already removed it). */
export async function stopContainer(spawn: SpawnLike, command: string, name: string): Promise<void> {
  await runEngine(spawn, command, ["stop", "-t", String(STOP_SECONDS), name], (STOP_SECONDS + 20) * 1000).catch(() => undefined)
  await runEngine(spawn, command, ["rm", "--force", name]).catch(() => undefined)
}

/** Starts one container per workspace and waits for its address line. */
export function containerLauncher(options: ContainerRunnerOptions): Launcher {
  const checked = checkSettings(options)
  const spawn = options.spawn ?? defaultSpawn()
  const timeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  const logCap = options.logCapBytes ?? DEFAULT_LOG_CAP_BYTES
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`))
  return (spec: WorkspaceSpec) => {
    // Every check runs before any command does: a hostile id never reaches the engine.
    let args: string[]
    let name: string
    try {
      args = containerRunArgs(spec, options, options.ticketPublicKey)
      name = containerName(spec.id)
    } catch (error) {
      return Promise.reject(error as Error)
    }
    return openNetwork(checked, name, spawn).then(() => new Promise<Launched>((done, fail) => {
      const child = spawn(checked.command, args, { env: clientEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false })
      const ended = new Promise<void>((over) => child.once("exit", () => over()))
      // When the `run` command ends the container is removed too, so a restart never meets a container of the same
      // name, and then its network, which nothing else ever joined but the hub.
      const exited = ended
        .then(() => runEngine(spawn, checked.command, ["rm", "--force", name]).then(() => undefined, () => undefined))
        .then(() => closeNetwork(checked, name, spawn))
      let settled = false
      let stdout = ""
      let logged = 0
      let stopping: Promise<void> | undefined
      const stop = () => {
        stopping ??= (async () => {
          child.stdin.end()
          await stopContainer(spawn, checked.command, name)
          if (child.exitCode === null && child.signalCode === null) {
            const killer = setTimeout(() => child.kill("SIGKILL"), STOP_SECONDS * 1000)
            await ended
            clearTimeout(killer)
          }
          await exited
        })()
        return stopping
      }
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) {
          void stop()
          fail(error)
          return
        }
        addressOf(checked, name, spawn).then(
          (address) => done({ address, exited, stop }),
          (failure: Error) => {
            void stop()
            fail(failure)
          },
        )
      }
      const timer = setTimeout(() => finish(new Error(`no address within ${timeoutMs} ms`)), timeoutMs)
      child.once("error", (error) => finish(error))
      child.once("exit", (code) => finish(new Error(`the container exited with code ${code} before it listened`)))
      // Kept open: the workspace stops when it closes (--stop-on-stdin-end), so a hub that dies takes its containers along.
      child.stdin.on("error", () => undefined)
      child.stdout.on("error", (error) => finish(error))
      child.stderr.on("error", () => undefined)
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
          checkReadyLine(stdout.slice(0, end).trim())
          finish()
        } catch (error) {
          finish(error as Error)
        }
      })
      child.stderr.setEncoding("utf8")
      child.stderr.on("data", (chunk: string) => {
        if (logged >= logCap) return
        const kept = chunk.slice(0, logCap - logged)
        logged += kept.length
        for (const line of kept.split(/\r?\n/)) if (line.trim() !== "") log(`workspace ${spec.id}: ${line.slice(0, 500)}`)
        if (logged >= logCap) log(`workspace ${spec.id}: log cap of ${logCap} bytes reached; further output is dropped`)
      })
    }))
  }
}

/** Whether the engine confirms no container of the workspace exists (running or not); false when it cannot say. */
export async function containerGone(spawn: SpawnLike, command: string, id: string): Promise<boolean> {
  const name = containerName(id)
  const result = await runEngine(spawn, command, ["ps", "--all", "--filter", `name=^${name}$`, "--format", "{{.Names}}"]).catch(() => undefined)
  return result !== undefined && result.code === 0 && result.stdout.trim() === ""
}

/** A runner of containers, one per workspace, behind the same lifecycle as every runner. */
export function createContainerRunner(options: ContainerRunnerOptions): ManagedRunner {
  const { command } = checkSettings(options)
  const spawn = options.spawn ?? defaultSpawn()
  return new ManagedRunner({
    launch: containerLauncher(options),
    confirmGone: (id) => containerGone(spawn, command, id),
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
    ...(options.maxRunning !== undefined ? { maxRunning: options.maxRunning } : {}),
    ...(options.log ? { log: options.log } : {}),
  })
}
