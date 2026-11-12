// The container runner: each workspace is `copperflow workspace` in a container of its own, the hosted service's
// security boundary (docs/hosted.md, "Running the hub"). Every engine command is an argument array given to `spawn`
// without a shell; nothing in it is taken from user text: the project id is checked against the id the store
// generates, the project folder and public origin are the hub's own, and every other value is a checked option.
import { spawn as nodeSpawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { isAbsolute } from "node:path"
import type { Readable, Writable } from "node:stream"
import { TICKET_PUBLIC_KEY_ENV } from "../../hosted/ticket.js"
import { ID_PATTERN } from "../secrets.js"
import { parseCidr, workspaceSubnets, type Subnet } from "../peer-guard.js"
import { shareWithWorkspaceGroup } from "../safe-files.js"
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

/**
 * 768 MB: the main thread's 160 MB heap, one build worker's 256 MB and one routing-or-placement worker's 256 MB (runs
 * are exclusive per workspace) make at most 672 MB, with room for native memory.
 */
export const DEFAULT_LIMITS: ContainerLimits = { memory: "768m", cpus: "1", pids: 128, openFiles: 1024, tmpSize: "64m" }
export const DEFAULT_CONTAINER_COMMAND = "docker"
/** The ports the two servers listen on inside every container. */
export const STUDIO_PORT = 8080
export const MCP_PORT = 8081
/** The uid every workspace container runs as: a dedicated unprivileged user that is never the hub's. */
export const WORKSPACE_UID = 10001
const GID = /^[1-9][0-9]{0,8}$/

/** The hub's own identity, as the operating system gives it (undefined on Windows, which has none of these). */
export interface HubIdentity {
  uid: number
  gid: number
  groups: number[]
}

export function currentIdentity(): HubIdentity | undefined {
  if (!process.getuid || !process.getgid || !process.getgroups) return undefined
  return { uid: process.getuid(), gid: process.getgid(), groups: process.getgroups() }
}

/**
 * The uid:gid every workspace container runs as. Normally 10001:<workspace group>: a user that is not the hub's and
 * shares only that group with it, so an escaped container reads none of the hub's own files (0600/0700, no group
 * access). With `sameUserAsHub` (a trial on one's own machine) it is the hub's own uid:gid. Never root.
 */
export function workspaceUser(settings: { group?: string; sameUserAsHub?: boolean }, identity: HubIdentity | undefined = currentIdentity()): string {
  if (identity?.uid === 0) throw new Error("The container runner refuses to start as root: run the hub as its own unprivileged user.")
  if (settings.sameUserAsHub) {
    if (!identity) return `${WORKSPACE_UID}:${WORKSPACE_UID}`
    return `${identity.uid}:${identity.gid}`
  }
  const group = settings.group
  if (group === undefined || !GID.test(group)) throw new Error("--workspace-group <gid> is required with the container runner: the one group the hub shares with its workspaces (docs/hosted.md).")
  if (identity) {
    if (identity.uid === WORKSPACE_UID) throw new Error(`The hub must not run as uid ${WORKSPACE_UID}, the workspaces' own user: give the hub a user of its own.`)
    if (identity.gid !== Number(group) && !identity.groups.includes(Number(group))) throw new Error(`The hub's user is not a member of group ${group}; add it (usermod -aG) and start the hub again.`)
  }
  return `${WORKSPACE_UID}:${group}`
}
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
  /** The gid of the one group the hub shares with its workspaces (--workspace-group); required unless sameUserAsHub. */
  group?: string
  /** Run workspaces as the hub's own user (--workspace-user-same-as-hub): for a trial on one's own machine only. */
  sameUserAsHub?: boolean
  /** Tests give the hub's identity; default the process's own. */
  identity?: HubIdentity
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
  /** uid:gid for --user. */
  user: string
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
  const identity = "identity" in settings ? settings.identity : currentIdentity()
  return { command, image, hubContainer, reach, limits, user: workspaceUser(settings, identity) }
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
    "--user", checked.user,
    // Nothing reaches the engine's own log files: the hub reads the ready line and a capped log from the attached
    // client's streams, so a container that prints forever cannot fill the engine's disk.
    "--log-driver", "none",
    "--read-only",
    "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=${limits.tmpSize}`,
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

/** The oldest engines whose internal networks do not forward DNS to the host's resolvers. */
export const MIN_DOCKER_MAJOR = 26
export const MIN_PODMAN_MAJOR = 5
/** The image label the Dockerfile sets from its NODE_IMAGE build argument. */
export const BASE_LABEL = "org.copperflow.base"

/**
 * What the hub checks before it starts with the container runner: the engine answers and is new enough, the image is
 * there, and the engine can do what the chosen reach needs (an internal network, and either a port published on
 * 127.0.0.1 on it or the hub's container joined to it). Throws a message that says what to do; returns warnings.
 */
export async function checkEngine(settings: ContainerSettings, spawn: SpawnLike = defaultSpawn()): Promise<string[]> {
  const checked = checkSettings(settings)
  const { command, image } = checked
  const version = await runEngine(spawn, command, ["version", "--format", "{{.Server.Version}}"]).catch((error: Error) => ({ code: -1, stdout: "", stderr: error.message }))
  if (version.code !== 0) throw new Error(`The container engine does not answer (\`${command} version\` failed). Start it, and make sure the user the hub runs as may use it.`)
  checkEngineVersion(command, version.stdout.trim())
  const found = await runEngine(spawn, command, ["image", "inspect", "--format", `{{index .Config.Labels "${BASE_LABEL}"}}`, image])
  if (found.code !== 0) throw new Error(`The workspace image ${image} is missing. ${BUILD_HINT}`)
  const warnings: string[] = []
  if (!found.stdout.includes("@sha256:")) {
    warnings.push(`Warning: the workspace image's base is not pinned by digest (${found.stdout.trim() || "unknown"}). Rebuild with --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:... (docs/hosted.md, "Running the hub").`)
  }
  await probeReach(checked, spawn)
  return warnings
}

/** One line for the start-up output: whether the engine runs rootless or with user-namespace remapping (from `info`). */
export async function engineModeLine(settings: ContainerSettings, spawn: SpawnLike = defaultSpawn()): Promise<string> {
  const { command } = checkSettings(settings)
  const info = await runEngine(spawn, command, ["info", "--format", "{{json .SecurityOptions}}"]).catch(() => undefined)
  const text = info?.code === 0 ? info.stdout : ""
  const modes = [/rootless/i.test(text) ? "rootless" : "", /userns/i.test(text) ? "user-namespace remapping" : ""].filter((mode) => mode !== "")
  return `Container engine mode: ${modes.length > 0 ? modes.join(" and ") : info?.code === 0 ? "rootful, no user-namespace remapping" : "unknown (docker info did not answer)"}.`
}

/** Refuses an engine too old for internal networks without DNS forwarding. */
export function checkEngineVersion(command: string, version: string): void {
  const major = Number(/^v?([0-9]+)\./.exec(version)?.[1])
  const podman = /podman/i.test(command)
  const min = podman ? MIN_PODMAN_MAJOR : MIN_DOCKER_MAJOR
  if (!Number.isInteger(major) || major < min) {
    throw new Error(
      `The container engine is version ${version || "unknown"}; the hub needs ${podman ? `Podman ${MIN_PODMAN_MAJOR}` : `Docker Engine ${MIN_DOCKER_MAJOR}`} or newer, because older engines forward DNS lookups from internal networks to the host's resolvers.`,
    )
  }
}

/** Makes an internal network and tries what the reach needs on it; always removes what it made. */
async function probeReach(checked: Checked, spawn: SpawnLike): Promise<void> {
  const { command } = checked
  const probe = `cf-check-${process.pid}`
  const made = await runEngine(spawn, command, networkCreateArgs(probe))
  if (made.code !== 0) throw new Error(`The hub could not create an internal network (${command} network create --internal): ${made.stderr.trim().slice(0, 300)}`)
  try {
    if (checked.reach === "network") {
      const joined = await runEngine(spawn, command, ["network", "connect", probe, checked.hubContainer as string])
      if (joined.code !== 0) throw new Error(`The hub's container ${checked.hubContainer} could not join an internal network: ${joined.stderr.trim().slice(0, 300)}`)
      await runEngine(spawn, command, ["network", "disconnect", "--force", probe, checked.hubContainer as string]).catch(() => undefined)
      return
    }
    const started = await runEngine(spawn, command, [
      "run", "--detach", "--rm", "--name", probe, "--label", CONTAINER_LABEL, "--log-driver", "none", "--user", checked.user,
      "--network", probe, "--publish", `127.0.0.1::${STUDIO_PORT}`, "--entrypoint", "node", checked.image, "-e", "setTimeout(() => {}, 60000)",
    ])
    try {
      if (started.code !== 0) throw new Error(`A probe container could not start: ${started.stderr.trim().slice(0, 300)}`)
      const port = await runEngine(spawn, command, ["port", probe, `${STUDIO_PORT}/tcp`])
      if (port.code !== 0 || !port.stdout.split(/\r?\n/).some((line) => LOOPBACK_PORT.test(line.trim()))) {
        throw new Error("This engine does not publish ports on 127.0.0.1 for an internal network. Run the hub in a container with --workspace-reach network --hub-container <name> instead.")
      }
    } finally {
      await runEngine(spawn, command, ["rm", "--force", probe]).catch(() => undefined)
    }
  } finally {
    const removed = await runEngine(spawn, command, ["network", "rm", probe]).catch(() => undefined)
    if (removed && removed.code !== 0) throw new Error(`The hub could not remove the network ${probe} it made: ${removed.stderr.trim().slice(0, 300)}`)
  }
}

/** The data directory goes into a --mount value: it must be absolute and hold no comma, quote or newline. */
export function checkDataDirForMounts(dataDir: string): void {
  if (!isAbsolute(dataDir) || /[,\0\r\n"]/.test(dataDir)) throw new Error("With the container runner the data directory must be an absolute path with no comma, quote or newline in it.")
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
  // Cleaning containers a crashed hub left running, too (cf-clean-<16 hex>).
  const cleaners = await runEngine(spawn, command, ["ps", "--all", "--filter", `label=${CONTAINER_LABEL}`, "--filter", "name=^cf-clean-", "--format", "{{.Names}}"])
  if (cleaners.code !== 0) throw new Error(`Could not list leftover cleaning containers: ${cleaners.stderr.trim().slice(0, 300)}`)
  const cleanerNames = cleaners.stdout.split(/\r?\n/).map((line) => line.trim()).filter((name) => /^cf-clean-[0-9a-f]{16}$/.test(name))
  for (const name of [...ourNames(listed.stdout), ...cleanerNames]) {
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

/** One opened workspace network: the engine's id for it, and the subnets this instance added to the peer guard. */
export interface OpenedNetwork {
  id: string
  subnets: Subnet[]
}

const NETWORK_ID = /^[0-9a-f]{12,64}$/

/** Opens and closes for one project run one after another, so a restart never interleaves with the old close. */
const networkQueues = new Map<string, Promise<unknown>>()

function serialised<T>(name: string, work: () => Promise<T>): Promise<T> {
  const before = networkQueues.get(name) ?? Promise.resolve()
  const run = before.then(work, work)
  const settled = run.catch(() => undefined)
  networkQueues.set(name, settled)
  void settled.then(() => {
    if (networkQueues.get(name) === settled) networkQueues.delete(name)
  })
  return run
}

/** Networks whose removal the engine has not confirmed: their subnets stay refused, and removal is tried again. */
const pendingRemovals = new Map<string, { checked: Checked; spawn: SpawnLike; opened: OpenedNetwork }>()

/** Creates the workspace's own network (removing a leftover of the same name first) and joins the hub to it. */
function openNetwork(checked: Checked, name: string, spawn: SpawnLike): Promise<OpenedNetwork> {
  return serialised(name, async () => {
    await retryPendingNetworks()
    await runEngine(spawn, checked.command, ["network", "rm", name]).catch(() => undefined)
    const made = await runEngine(spawn, checked.command, networkCreateArgs(name))
    const id = made.stdout.trim().split(/\r?\n/)[0] ?? ""
    if (made.code !== 0) throw new Error(`the workspace network could not be created: ${made.stderr.trim().slice(0, 200)}`)
    // The hub refuses connections from inside this network (peer-guard.ts), so its subnets are recorded before
    // anything runs on it; without them the launch fails. Everything after this names the instance by its id.
    const ref = NETWORK_ID.test(id) ? id : name
    const inspected = await runEngine(spawn, checked.command, ["network", "inspect", "--format", "{{range .IPAM.Config}}{{.Subnet}} {{end}}", ref])
    const parsed = inspected.code === 0 ? inspected.stdout.trim().split(/\s+/).filter((text) => text !== "").map(parseCidr) : []
    const opened: OpenedNetwork = { id: ref, subnets: [] }
    if (parsed.length === 0 || parsed.some((subnet) => subnet === undefined)) {
      await removeOpened(checked, spawn, opened)
      throw new Error("the workspace network's subnet could not be read")
    }
    for (const subnet of parsed as Subnet[]) {
      workspaceSubnets.add(subnet)
      opened.subnets.push(subnet)
    }
    if (checked.hubContainer === undefined) return opened
    const joined = await runEngine(spawn, checked.command, ["network", "connect", ref, checked.hubContainer])
    if (joined.code !== 0) {
      await removeOpened(checked, spawn, opened)
      throw new Error(`the hub could not join the workspace network: ${joined.stderr.trim().slice(0, 200)}`)
    }
    return opened
  })
}

/** Takes the hub off one network instance and removes it; its subnets are forgotten only once the engine confirms. */
function closeNetwork(checked: Checked, name: string, spawn: SpawnLike, opened: OpenedNetwork): Promise<void> {
  return serialised(name, () => removeOpened(checked, spawn, opened))
}

async function removeOpened(checked: Checked, spawn: SpawnLike, opened: OpenedNetwork): Promise<void> {
  if (checked.hubContainer !== undefined) await runEngine(spawn, checked.command, ["network", "disconnect", "--force", opened.id, checked.hubContainer]).catch(() => undefined)
  const removed = await runEngine(spawn, checked.command, ["network", "rm", opened.id]).catch(() => undefined)
  let gone = removed?.code === 0
  if (!gone) {
    const still = await runEngine(spawn, checked.command, ["network", "inspect", "--format", "{{.Id}}", opened.id]).catch(() => undefined)
    gone = still !== undefined && still.code !== 0 && /not found|no such network/i.test(still.stderr)
  }
  if (!gone) {
    // Kept refused: the network may still exist with something on it. Tried again before the next network opens.
    pendingRemovals.set(opened.id, { checked, spawn, opened })
    process.stderr.write(`copperflow hub: workspace network ${opened.id.slice(0, 12)} could not be confirmed removed; its subnet stays refused\n`)
    return
  }
  pendingRemovals.delete(opened.id)
  for (const subnet of opened.subnets) workspaceSubnets.remove(subnet)
  opened.subnets = []
}

/** Tries again to remove every network whose removal was not confirmed (at each launch and each hub start). */
export async function retryPendingNetworks(): Promise<void> {
  for (const { checked, spawn, opened } of [...pendingRemovals.values()]) await removeOpened(checked, spawn, opened)
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
    // An older folder gets the workspace group and mode 2770 before its container starts (the folder itself only).
    const shared = options.sameUserAsHub ? Promise.resolve() : shareWithWorkspaceGroup(spec.projectDir, Number(checked.user.split(":")[1]))
    return shared.then(() => openNetwork(checked, name, spawn)).then((network) => new Promise<Launched>((done, fail) => {
      const child = spawn(checked.command, args, { env: clientEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false })
      // A spawn error may never be followed by an exit: it ends the command too, so the network is still removed.
      const ended = new Promise<void>((over) => {
        child.once("exit", () => over())
        child.once("error", () => over())
      })
      // When the `run` command ends the container is removed too, so a restart never meets a container of the same
      // name, and then its network, which nothing else ever joined but the hub.
      const exited = ended
        .then(() => runEngine(spawn, checked.command, ["rm", "--force", name]).then(() => undefined, () => undefined))
        .then(() => closeNetwork(checked, name, spawn, network))
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

/** How long the cleaning container may take. */
export const CLEAN_TIMEOUT_MS = 120_000

/**
 * The whole `docker run` argument array of the short-lived cleaning container: the workspace user, ONLY the one trash
 * folder mounted, no network at all, the workspace hardening, and the fixed command built into the image.
 */
export function cleanerRunArgs(trashDir: string, settings: ContainerSettings, name: string): string[] {
  const checked = checkSettings(settings)
  if (!/^cf-clean-[0-9a-f]{16}$/.test(name)) throw new Error("refused: not a cleaner name")
  if (!/^(\/|[A-Za-z]:[\\/])/.test(trashDir) || /[,\0\r\n"]/.test(trashDir)) throw new Error("refused: the trash folder is not a plain absolute path")
  return [
    "run",
    "--rm",
    "--name", name,
    "--label", CONTAINER_LABEL,
    "--user", checked.user,
    "--log-driver", "none",
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--network", "none",
    "--pids-limit", "32",
    "--memory", "128m",
    "--memory-swap", "128m",
    "--cpus", "0.5",
    "--ulimit", "nofile=1024:1024",
    "--mount", `type=bind,source=${trashDir},target=/work`,
    "--workdir", "/work",
    "--entrypoint", "node",
    checked.image,
    "--max-old-space-size=96",
    "/app/dist/cli.js",
    "workspace-clean",
    "/work",
  ]
}

/** Empties a trash folder as the workspace user; throws when the container fails or runs past its time limit. */
export async function runCleaner(settings: ContainerSettings, trashDir: string, spawn: SpawnLike = defaultSpawn(), timeoutMs = CLEAN_TIMEOUT_MS): Promise<void> {
  const { command } = checkSettings(settings)
  const name = `cf-clean-${randomBytes(8).toString("hex")}`
  const args = cleanerRunArgs(trashDir, settings, name)
  const result = await runEngine(spawn, command, args, timeoutMs).catch((error: Error) => ({ code: -1, stdout: "", stderr: error.message }))
  if (result.code !== 0) {
    await runEngine(spawn, command, ["rm", "--force", name]).catch(() => undefined)
    throw new Error(`the cleaning container failed: ${result.stderr.trim().slice(0, 200)}`)
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
    maintain: retryPendingNetworks,
    clean: (dir) => runCleaner(options, dir, spawn),
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
    ...(options.maxRunning !== undefined ? { maxRunning: options.maxRunning } : {}),
    ...(options.log ? { log: options.log } : {}),
  })
}
