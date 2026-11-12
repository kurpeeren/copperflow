// copperflow hub: the hub server, and the maintainer's commands that work on its data directory directly.
import { spawn as nodeSpawn } from "node:child_process"
import { open, readdir, readFile } from "node:fs/promises"
import { isIP } from "node:net"
import { checkDataDir } from "./check-data.js"
import { trustedProxies } from "./peer-guard.js"
import { prepareDataDir } from "./permissions.js"
import { basename, join, resolve } from "node:path"
import { trashFailures } from "./project-folders.js"
import { printable, sanitisingLog } from "./printable.js"
import { CONTAINER_OPTIONS, helpLines, hubCommandNamed, MAX_INVITES, SERVER_OPTIONS, USAGE, VALUELESS_FLAGS } from "./hub-usage.js"
import { writeFileAtomic } from "../core/fs-utils.js"
import type { CliIO } from "../cli-commands.js"
import { AgentSessions } from "./agent-sessions.js"
import { OAuthState } from "./oauth-state.js"
import { revokeUser, type RevokingHub } from "./revocation.js"
import { measureTree } from "./safe-files.js"
import { hashPassword, hashSecret, newSecret } from "./secrets.js"
import { sameSiteWarning, startHub, TRUSTED_ONLY_WARNING, WORKSPACE_DOMAIN, type HubOptions } from "./server.js"
import { HubStore, normaliseEmail } from "./store.js"
import type { WorkspaceRunner } from "./runner/runner.js"
import {
  CONTAINER_PREFIX,
  engineModeLine,
  checkDataDirForMounts,
  checkEngine,
  checkSettings,
  createContainerRunner,
  DEFAULT_CONTAINER_COMMAND,
  runEngine,
  sweepLeftovers,
  type ContainerSettings,
  type HubIdentity,
  type SpawnLike,
} from "./runner/container-runner.js"

export const STATUS_FILE = "hub-status.json"
const STATUS_EVERY_MS = 15_000
const STATUS_STALE_MS = 2 * 60_000
/** Splits `--name value` options from the rest; the flags without a value are the table's (hub-usage.ts). */
function parse(args: readonly string[]): { options: Map<string, string>; flags: Set<string>; rest: string[] } {
  const options = new Map<string, string>()
  const flags = new Set<string>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string
    if (VALUELESS_FLAGS.has(arg)) flags.add(arg)
    else if (arg.startsWith("--")) {
      const value = args[i + 1]
      if (value === undefined || value === "") throw new Error(`Missing ${arg} value.\n${USAGE}`)
      options.set(arg, value)
      i += 1
    } else rest.push(arg)
  }
  return { options, flags, rest }
}

function dataDirOf(options: Map<string, string>, cwd: string): string {
  const data = options.get("--data")
  if (!data) throw new Error(`Missing --data <dir>.\n${USAGE}`)
  return resolve(cwd, data)
}

async function openStore(dataDir: string): Promise<HubStore> {
  return HubStore.open(await prepareDataDir(dataDir))
}

/** A stand-in for the maintainer's commands, which run beside the hub and cannot reach its workspaces. */
const NO_RUNNER: WorkspaceRunner = {
  ensure: async () => Promise.reject(new Error("not available in a maintainer command")),
  hold: () => () => undefined,
  stop: async () => undefined,
  state: () => "stopped",
  running: () => 0,
  active: () => [],
  block: async () => undefined,
  unblock: () => undefined,
  setStartCheck: () => undefined,
  stopUser: async () => undefined,
  stopAll: async () => undefined,
}

/**
 * `hub --help`, `hub -h`, `hub help [command]` and `hub <command> --help`: the usage from the option table, printed
 * through `printable`, before any option is parsed or any data directory is touched. Undefined when help was not asked.
 */
/** Longer than the longest usage line (the server's). */
const HELP_LINE_MAX = 1000

function helpRequested(args: readonly string[], io: CliIO): number | undefined {
  const asked = args[0] === "help" || args.includes("--help") || args.includes("-h")
  if (!asked) return undefined
  // The command is the first word that is not an option or an option's value; options this table does not know are not
  // examined here (a trailing option without a value is not an error when help was asked for).
  let words: string[] = []
  try {
    words = parse((args[0] === "help" ? args.slice(1) : args).filter((arg) => arg !== "--help" && arg !== "-h")).rest
  } catch {
    words = []
  }
  const named = words[0]
  const command = named === undefined ? undefined : hubCommandNamed(named)
  if (named !== undefined && command === undefined) throw new Error(`Unknown hub command "${printable(named)}".\n${USAGE}`)
  for (const line of helpLines(command)) io.out(printable(line, HELP_LINE_MAX))
  return 0
}

export async function runHubCommand(args: string[], cwd: string, io: CliIO): Promise<number> {
  const helped = helpRequested(args, io)
  if (helped !== undefined) return helped
  const { options, flags, rest } = parse(args)
  const [command, email] = rest
  if (command === undefined) return serve(args, cwd, io)
  const dataDir = dataDirOf(options, cwd)
  // Before the store is opened: it checks what opening would refuse, and must not create or migrate anything.
  if (command === "check-data") return checkData(dataDir, options, flags, io)
  const store = await openStore(dataDir)
  try {
    switch (command) {
      case "invite":
        return await invite(store, dataDir, options, io)
      case "stop-workspace":
        return stopWorkspace(store, email, io)
      case "reset-password":
        return await resetPassword(store, email, io)
      case "status":
        return await status(store, dataDir, io, flags.has("--json"))
      case "backup":
        return await backup(store, options, cwd, io)
      case "delete-user":
        return await deleteUser(store, dataDir, email, io)
      default:
        throw new Error(`Unknown hub command "${command}".\n${USAGE}`)
    }
  } finally {
    store.close()
  }
}

export type RunnerChoice = { kind: "process"; trustedAccountsOnly: boolean } | { kind: "container"; settings: ContainerSettings }

/** Said at start with --workspace-user-same-as-hub. */
export const SAME_USER_WARNING =
  "Warning: --workspace-user-same-as-hub runs workspaces as the hub's own user, so a container escape would run as the hub's user and could read its keys and database. Use it only for a trial on your own machine; give strangers' accounts --workspace-group instead."

/** The runner the flags ask for: `--runner process` (the default, as before) or `--runner container`. */
export function chooseRunner(options: Map<string, string>, flags: Set<string>, identity?: { value: HubIdentity | undefined }): RunnerChoice {
  const kind = options.get("--runner") ?? "process"
  if (kind === "process") {
    const stray = CONTAINER_OPTIONS.find((name) => options.has(name)) ?? (flags.has("--workspace-user-same-as-hub") ? "--workspace-user-same-as-hub" : undefined)
    if (stray) throw new Error(`${stray} belongs to --runner container.\n${USAGE}`)
    return { kind, trustedAccountsOnly: flags.has("--trusted-accounts-only") }
  }
  if (kind !== "container") throw new Error(`--runner must be container or process.\n${USAGE}`)
  const image = options.get("--workspace-image")
  if (!image) throw new Error(`Missing --workspace-image <name>: the image built from deploy/workspace.Dockerfile.\n${USAGE}`)
  const reach = options.get("--workspace-reach") ?? "loopback"
  if (reach !== "loopback" && reach !== "network") throw new Error(`--workspace-reach must be loopback or network.\n${USAGE}`)
  const command = options.get("--container-command")
  const hubContainer = options.get("--hub-container")
  const group = options.get("--workspace-group")
  const sameUserAsHub = flags.has("--workspace-user-same-as-hub")
  const settings: ContainerSettings = { image, reach, ...(command ? { command } : {}), ...(hubContainer ? { hubContainer } : {}), ...(group ? { group } : {}), ...(sameUserAsHub ? { sameUserAsHub } : {}) }
  checkSettings(identity ? { ...settings, identity: identity.value } : settings)
  return { kind, settings }
}

/** With the container runner: the engine is checked and last run's leftovers swept before the hub listens. */
export async function runnerFor(choice: RunnerChoice, io: CliIO, spawn?: SpawnLike, log: (text: string) => void = (text) => void process.stderr.write(text)): Promise<Pick<HubOptions, "runner" | "trustedAccountsOnly" | "workspaceGroup">> {
  if (choice.kind === "process") return { trustedAccountsOnly: choice.trustedAccountsOnly }
  for (const warning of await checkEngine(choice.settings, spawn)) io.out(printable(warning, 400))
  if (choice.settings.sameUserAsHub) io.out(SAME_USER_WARNING)
  io.out(printable(await engineModeLine(choice.settings, spawn)))
  // The engine's stderr can carry text a container influenced: printable only.
  const removed = await sweepLeftovers(choice.settings, spawn, (line) => io.out(printable(line, 300)))
  if (removed > 0) io.out(`Removed ${removed} workspace container(s) left from an earlier run.`)
  return {
    // An explicit sanitising log: workspace output and engine errors reach the maintainer one printable line at a time.
    runner: (ticketPublicKey) => createContainerRunner({ ...choice.settings, ticketPublicKey, log: sanitisingLog("copperflow hub: ", log), ...(spawn ? { spawn } : {}) }),
    ...(choice.settings.group && !choice.settings.sameUserAsHub ? { workspaceGroup: Number(choice.settings.group) } : {}),
  }
}

/** The hub's command line, every value checked for its shape before anything starts. */
export interface ServeArgs {
  dataDir: string
  port: number
  publicOrigin: string
  workspaceDomain: string
  bind: string
  trustProxy?: string
  hstsIncludeSubdomains: boolean
  choice: RunnerChoice
}

/**
 * Parses and checks `copperflow hub ...` (the server). `identity`, when given, replaces the process's own uid and groups
 * in the runner's checks (the deploy-file test checks argument shapes on a machine without the hub's user).
 */
export function parseServeArgs(args: readonly string[], cwd: string, identity?: { value: HubIdentity | undefined }): ServeArgs {
  const { options, flags, rest } = parse(args)
  if (rest.length > 0) throw new Error(`Unexpected "${printable(rest[0])}".\n${USAGE}`)
  const known = new Set(SERVER_OPTIONS)
  const stray = [...options.keys()].find((name) => !known.has(name))
  if (stray) throw new Error(`Unknown option ${printable(stray)}.\n${USAGE}`)
  const dataDir = dataDirOf(options, cwd)
  const port = Number(options.get("--port"))
  if (!/^[0-9]{1,5}$/.test(options.get("--port") ?? "") || port > 65_535) throw new Error(`--port must be a port number.\n${USAGE}`)
  const publicOrigin = options.get("--public-origin")
  if (!publicOrigin) throw new Error(`Missing --public-origin <url>.\n${USAGE}`)
  if (!URL.canParse(publicOrigin) || !/^https?:$/.test(new URL(publicOrigin).protocol)) throw new Error(`--public-origin must be a URL such as https://copperflow.example.com.\n${USAGE}`)
  const choice = chooseRunner(options, flags, identity)
  if (choice.kind === "container") checkDataDirForMounts(dataDir)
  const workspaceDomain = options.get("--workspace-domain")
  if (!workspaceDomain) throw new Error(`Missing --workspace-domain <domain>: each project is served on its own origin under it.\n${USAGE}`)
  if (!WORKSPACE_DOMAIN.test(workspaceDomain.toLowerCase())) throw new Error(`--workspace-domain must be a domain name, such as ws.copperflow.example.com.\n${USAGE}`)
  const bind = options.get("--bind") ?? "127.0.0.1"
  if (isIP(bind) === 0) throw new Error(`--bind must be an IP address.\n${USAGE}`)
  const trustProxy = options.get("--trust-proxy")
  if (trustProxy !== undefined) trustedProxies(trustProxy)
  return { dataDir, port, publicOrigin, workspaceDomain, bind, ...(trustProxy !== undefined ? { trustProxy } : {}), hstsIncludeSubdomains: flags.has("--hsts-include-subdomains"), choice }
}

async function serve(args: readonly string[], cwd: string, io: CliIO): Promise<number> {
  const { dataDir, port, publicOrigin, workspaceDomain, bind, trustProxy, hstsIncludeSubdomains, choice } = parseServeArgs(args, cwd)
  const runner = await runnerFor(choice, io)
  const hub = await startHub({ dataDir, port, publicOrigin, workspaceDomain, bind, ...(trustProxy !== undefined ? { trustProxy } : {}), hstsIncludeSubdomains, ...runner })
  if (choice.kind === "process" && choice.trustedAccountsOnly) io.out(TRUSTED_ONLY_WARNING)
  const siteWarning = sameSiteWarning(publicOrigin, workspaceDomain)
  if (siteWarning) io.out(siteWarning)
  const runnerStatus =
    choice.kind === "container"
      ? { runner: "container", command: choice.settings.command ?? DEFAULT_CONTAINER_COMMAND, ...(runner.workspaceGroup !== undefined ? { workspaceGroup: runner.workspaceGroup } : {}) }
      : { runner: "process" }
  const writeStatus = () =>
    writeFileAtomic(join(dataDir, STATUS_FILE), `${JSON.stringify({ updated: Date.now(), pid: process.pid, running: hub.hub.runner.running(), ...runnerStatus, trashFailures: trashFailures(3).map((failure) => ({ name: basename(failure.path), failures: failure.failures, reason: failure.reason })) })}\n`).catch((error: unknown) =>
      hub.hub.log(`could not write ${STATUS_FILE}: ${(error as Error).message}`),
    )
  await writeStatus()
  const timer = setInterval(() => void writeStatus(), STATUS_EVERY_MS)
  timer.unref()
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    clearInterval(timer)
    setTimeout(() => process.exit(0), 10_000).unref()
    void hub.close().then(() => process.exit(0))
  }
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
  installSafetyNet(hub.hub.store, stop)
  io.out(`copperflow hub is listening at ${hub.url} for ${new URL(publicOrigin).origin}.`)
  return 0
}

/**
 * The last line, not relied on: every stream chain already reports its errors. An unhandled rejection is recorded
 * and the hub keeps serving (it was a request that failed, and the request's own handler has answered or closed it).
 * An uncaught exception is recorded and the hub closes cleanly, since its state can no longer be trusted; the service
 * manager restarts it. The audit line holds only the error's name and code, never its message (it might quote input).
 */
export function installSafetyNet(store: HubStore, stop: () => void, on: Pick<NodeJS.Process, "on"> = process): void {
  const record = (event: string, error: unknown) => {
    const name = error instanceof Error ? error.name : typeof error
    const code = (error as NodeJS.ErrnoException | undefined)?.code ?? ""
    try {
      store.audit({ time: Date.now(), userId: null, event, address: "hub", detail: `${name}${code ? ` ${code}` : ""}`.slice(0, 80) })
    } catch {
      // The store itself may be what failed; stderr still has it.
    }
    process.stderr.write(`copperflow hub: ${printable(`${event}: ${name}${code ? ` ${code}` : ""}`, 200)}\n`)
  }
  on.on("unhandledRejection", (error: unknown) => record("hub-unhandled-rejection", error))
  on.on("uncaughtException", (error: unknown) => {
    record("hub-uncaught-exception", error)
    stop()
  })
}

async function invite(store: HubStore, dataDir: string, options: Map<string, string>, io: CliIO): Promise<number> {
  const count = Number(options.get("--count") ?? "1")
  if (!Number.isInteger(count) || count < 1 || count > MAX_INVITES) throw new Error(`--count must be a whole number from 1 to ${MAX_INVITES}`)
  const codes = Array.from({ length: count }, () => newSecret())
  for (const code of codes) store.addInvite(hashSecret(code), Date.now())
  store.audit({ time: Date.now(), userId: null, event: "invites-made", address: "cli", detail: String(count) })
  io.out(`${count === 1 ? "An invite code" : `${count} invite codes`}, shown only now (the hub keeps only their hashes):`)
  for (const code of codes) io.out(code)
  const runner = await lastRunner(dataDir)
  if (runner === "process") io.out(TRUSTED_ONLY_WARNING)
  else if (runner === undefined) io.out(RUNNER_UNKNOWN_NOTE)
  return 0
}

/** Said by `hub invite` before the hub has ever written its status file. */
export const RUNNER_UNKNOWN_NOTE = "The hub has not run yet: start the hub first to know which runner is in use (with the process runner every account can read every other account's data)."

/** The runner the hub last started with, from its status file, whatever its age; undefined when it has never run. */
async function lastRunner(dataDir: string): Promise<"process" | "container" | undefined> {
  try {
    const written = JSON.parse(await readFile(join(dataDir, STATUS_FILE), "utf8")) as { runner?: unknown }
    return written.runner === "process" || written.runner === "container" ? written.runner : undefined
  } catch {
    return undefined
  }
}

/**
 * `hub check-data`: the ownership and modes the hub relies on (src/hub/check-data.ts), each problem one printable line,
 * exit 1 when any is left. --fix (only with the hub stopped) repairs what this user may and lists what needs root.
 */
async function checkData(dataDir: string, options: Map<string, string>, flags: Set<string>, io: CliIO): Promise<number> {
  if (process.platform === "win32") {
    io.out("Owners and modes are not checked on Windows (they are POSIX ones; access lists decide there).")
    return 0
  }
  const fix = flags.has("--fix")
  const written = await readStatusFile(dataDir)
  const group = options.get("--workspace-group") ?? (typeof written.workspaceGroup === "number" ? String(written.workspaceGroup) : undefined)
  if (group === undefined || !/^[1-9][0-9]{0,8}$/.test(group)) throw new Error(`Give --workspace-group <gid> (the hub's status file does not name it).\n${USAGE}`)
  if (fix) for (const line of await fixGate(written, flags.has("--no-workspaces-running"))) io.out(printable(line, 300))
  const result = await checkDataDir(dataDir, { group: Number(group), fix })
  for (const line of result.fixed) io.out(`fixed: ${printable(line, 300)}`)
  for (const line of result.problems) io.out(printable(line, 300))
  if (result.needsRoot.length > 0) io.out(`${result.needsRoot.length} of these belong to another user and need root (chown/chmod as root, then run this again).`)
  io.out(result.problems.length === 0 ? `The data directory has no problems${result.fixed.length > 0 ? ` (${result.fixed.length} fixed)` : ""}.` : `${result.problems.length} problem(s) left.`)
  return result.problems.length === 0 ? 0 : 1
}

type StatusWritten = { updated?: unknown; runner?: unknown; command?: unknown; workspaceGroup?: unknown }

async function readStatusFile(dataDir: string): Promise<StatusWritten> {
  try {
    return JSON.parse(await readFile(join(dataDir, STATUS_FILE), "utf8")) as StatusWritten
  } catch {
    return {} // No status file: the hub has not run here (a restored copy, for instance).
  }
}

/**
 * Whether `check-data --fix` may change anything: never as root, never while the hub runs, and only when nothing else
 * can touch the data. With the container runner (or an unknown one) the engine must answer that no `cf-ws-*` or
 * `cf-clean-*` container exists; with the process runner the maintainer vouches with --no-workspaces-running. Throws
 * the reason; returns lines to print.
 */
export async function fixGate(written: StatusWritten, noWorkspacesRunning: boolean, spawn?: SpawnLike, uid = process.getuid?.()): Promise<string[]> {
  if (uid === 0) throw new Error("Not fixed: --fix does not run as root (a chmod by root through a planted link is the worst case). Run it as the hub's user; root's part of a restore is tar alone.")
  if (typeof written.updated === "number" && Date.now() - written.updated < STATUS_STALE_MS) {
    throw new Error(`Not fixed: the hub is running (its status file was written ${Math.round((Date.now() - written.updated) / 1000)} s ago). Stop it first; after a hard kill, wait two minutes.`)
  }
  if (written.runner === "process") {
    if (!noWorkspacesRunning) throw new Error("Not fixed: with the process runner nothing here can see workspace processes. Make sure none is left (ps -u <hub user> shows no `copperflow workspace`), then add --no-workspaces-running.")
    return ["The process runner: relying on --no-workspaces-running that no workspace process is left."]
  }
  const command = written.command === "podman" ? "podman" : "docker"
  const run = spawn ?? ((cmd, args, options) => nodeSpawn(cmd, args, options))
  const listing = await runEngine(run, command, ["ps", "--all", "--format", "{{.Names}}"], 15_000).catch(() => undefined)
  if (!listing || listing.code !== 0) {
    throw new Error(`Not fixed: the container engine (${command}) could not be asked whether workspace containers are left. Check by hand with \`${command} ps --all\` (no name starting cf-ws- or cf-clean-), and run --fix where the engine answers.`)
  }
  const left = listing.stdout.split(/\r?\n/).filter((name) => name.startsWith(CONTAINER_PREFIX) || name.startsWith("cf-clean-"))
  if (left.length > 0) throw new Error(`Not fixed: ${left.length} workspace or cleaning container(s) still exist (${printable(left.slice(0, 3).join(", "), 200)}); they can change the data meanwhile. Stop the hub's containers first.`)
  return []
}

const PROJECT_ID = /^[0-9a-f]{32}$/

/** `hub stop-workspace <project id>`: recorded in the store; the running hub's sweep stops it within 15 seconds. */
function stopWorkspace(store: HubStore, projectId: string | undefined, io: CliIO): number {
  if (!projectId || !PROJECT_ID.test(projectId)) throw new Error(`The project id must be 32 lower-case hex characters (it is in the Studio's address, /p/<id>/).\n${USAGE}`)
  if (!store.projectExists(projectId)) throw new Error(`There is no project ${printable(projectId)}`)
  store.requestStop(projectId, Date.now())
  store.audit({ time: Date.now(), userId: null, event: "workspace-stop-requested", address: "cli", detail: projectId })
  io.out(`The running hub stops the workspace of project ${printable(projectId)} within 15 seconds (nothing happens if it is not running). Its next request starts it again.`)
  return 0
}

/** What a maintainer's command, in its own process, can revoke: the database; the running hub does the rest. */
function offlineHub(store: HubStore): RevokingHub {
  return { store, agents: new AgentSessions(), oauth: new OAuthState(), runner: NO_RUNNER, userCuts: new Map(), epochs: new Map() }
}

async function resetPassword(store: HubStore, email: string | undefined, io: CliIO): Promise<number> {
  if (!email) throw new Error(`Missing the email.\n${USAGE}`)
  const user = store.userByEmail(email)
  if (!user) throw new Error(`There is no user with the email ${printable(normaliseEmail(email))}`)
  const password = newSecret()
  store.setPassword(user.id, await hashPassword(password), true)
  await revokeUser(offlineHub(store), user.id)
  // The running hub repeats the revocation at its next sweep, with what only it holds (agent sessions, streams).
  store.requestCut(user.id, Date.now())
  store.audit({ time: Date.now(), userId: user.id, event: "password-reset", address: "cli", detail: "" })
  io.out(`A one-time password for ${printable(user.email)}, shown only now. Every session of the user has ended; they must choose a new password when they next sign in:`)
  io.out(password)
  return 0
}

/** What `hub status` reports; every string in it has passed through `printable`. null is "unknown". */
export interface StatusReport {
  users: number
  projects: number
  unusedInvites: number
  /** From the running hub's status file, when it was written in the last 2 minutes. */
  runner: "process" | "container" | null
  running: number | null
  containerMemory: string[]
  trashPending: number
  trashStuck: { name: string; failures: number; reason: string }[]
  diskBytes: number | null
  /** Why the disk could not be measured; not part of the JSON form's fixed fields when it was. */
  diskFailed?: string
}

async function statusReport(store: HubStore, dataDir: string): Promise<StatusReport> {
  // lstat only, never opening a file (workspaces may be running), with a generous cap for the whole tree.
  const measured = await measureTree(join(dataDir, "projects"), { maxEntries: 5_000_000, maxMs: 60_000 })
  let running: number | null = null
  let runner: StatusReport["runner"] = null
  let engine: string | undefined
  let stuck: StatusReport["trashStuck"] = []
  try {
    const written = JSON.parse(await readFile(join(dataDir, STATUS_FILE), "utf8")) as { updated?: unknown; running?: unknown; runner?: unknown; command?: unknown; trashFailures?: unknown }
    if (typeof written.updated === "number" && typeof written.running === "number" && Date.now() - written.updated < STATUS_STALE_MS) {
      running = written.running
      if (Array.isArray(written.trashFailures)) {
        stuck = (written.trashFailures as { name?: unknown; failures?: unknown; reason?: unknown }[])
          .filter((entry) => typeof entry.name === "string" && typeof entry.failures === "number")
          .map((entry) => ({ name: printable(entry.name, 80), failures: entry.failures as number, reason: printable(entry.reason, 40) }))
      }
      if (written.runner === "process" || written.runner === "container") runner = written.runner
      // Only the two known engine names are taken from the file and run.
      if (written.runner === "container" && (written.command === "docker" || written.command === "podman")) engine = written.command
    }
  } catch {
    // No status file yet: the hub has not run.
  }
  const trash = await readdir(join(dataDir, "trash")).catch(() => [] as string[])
  return {
    ...store.counts(),
    runner,
    running,
    containerMemory: engine ? (await containerMemory(engine)).map((line) => printable(line)) : [],
    trashPending: trash.length,
    trashStuck: stuck,
    diskBytes: "bytes" in measured ? measured.bytes : null,
    ...("bytes" in measured ? {} : { diskFailed: printable(measured.failed) }),
  }
}

async function status(store: HubStore, dataDir: string, io: CliIO, json: boolean): Promise<number> {
  const report = await statusReport(store, dataDir)
  if (json) {
    // One line for monitoring: the fixed fields only.
    const { diskFailed: _failed, ...fields } = report
    io.out(JSON.stringify(fields))
    return 0
  }
  io.out(`Users: ${report.users}`)
  io.out(`Projects: ${report.projects}`)
  io.out(`Unused invite codes: ${report.unusedInvites}`)
  io.out(`Runner: ${printable(report.runner ?? "unknown")}`)
  io.out(`Running workspaces: ${printable(report.running ?? "unknown (the hub is not running, or has not written its status in the last 2 minutes)")}`)
  for (const line of report.containerMemory) io.out(`  ${printable(line)}`)
  if (report.trashPending > 0) io.out(`Trash not yet removed: ${report.trashPending} folder(s) (still counted in their users' usage; the hub retries with a growing delay)`)
  if (report.trashStuck.length > 0) {
    io.out("Trash that failed more than three times:")
    for (const entry of report.trashStuck) io.out(`  ${printable(entry.name, 80)}: ${printable(entry.failures, 12)} failed attempts (${printable(entry.reason, 40)})`)
  }
  io.out(`Disk used by projects: ${report.diskBytes !== null ? `${(report.diskBytes / (1024 * 1024)).toFixed(1)} MB` : `unknown (${report.diskFailed ?? ""})`}`)
  return 0
}

/**
 * `hub backup --to <file>`: a consistent online copy of hub.db (VACUUM INTO, the same node:sqlite the hub uses), made
 * owner-only, checked and counted; prints the counts as one JSON line for the restore test to compare.
 */
async function backup(store: HubStore, options: Map<string, string>, cwd: string, io: CliIO): Promise<number> {
  const to = options.get("--to")
  if (!to) throw new Error(`Missing --to <file>: where the copy of the database is written.\n${USAGE}`)
  const file = resolve(cwd, to)
  // Created empty and owner-only first (VACUUM INTO accepts an empty file), so the copy is never readable by others.
  const handle = await open(file, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    throw new Error(error.code === "EEXIST" ? `${printable(file)} already exists; give a new file name` : `cannot create ${printable(file)}: ${printable(error.code ?? error.message)}`)
  })
  await handle.close()
  try {
    store.backupTo(file)
    io.out(JSON.stringify(HubStore.checkBackup(file)))
  } catch (error) {
    // This command removes nothing: the unfinished file is named for the maintainer to delete.
    throw new Error(`the backup failed (${printable((error as Error).message, 200)}); ${printable(file)} is incomplete, delete it`)
  }
  return 0
}

/** Each running workspace container's memory, from one `stats --no-stream`; nothing when the engine does not answer. */
export async function containerMemory(command: string, spawn?: SpawnLike): Promise<string[]> {
  const run = spawn ?? ((cmd, args, options) => nodeSpawn(cmd, args, options))
  const result = await runEngine(run, command, ["stats", "--no-stream", "--format", "{{.Name}}\t{{.MemUsage}}"], 15_000).catch(() => undefined)
  if (!result || result.code !== 0) return ["(container memory unavailable: the engine did not answer)"]
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter(([name, usage]) => name?.startsWith(CONTAINER_PREFIX) && /^[0-9a-f]{32}$/.test(name.slice(CONTAINER_PREFIX.length)) && usage !== undefined)
    .map(([name, usage]) => `${printable(name, 80)}: ${printable((usage as string).replace(/[^0-9A-Za-z./ ]/g, ""), 60)}`)
}

async function deleteUser(store: HubStore, dataDir: string, email: string | undefined, io: CliIO): Promise<number> {
  if (!email) throw new Error(`Missing the email.\n${USAGE}`)
  const user = store.userByEmail(email)
  if (!user) throw new Error(`There is no user with the email ${printable(normaliseEmail(email))}`)
  if (!io.ask) throw new Error("hub delete-user must be run by a person in an interactive terminal")
  const projects = store.projectCount(user.id)
  const answer = await io.ask(`This deletes ${printable(user.email)}, their sessions and ${projects} project(s) with all files. Type the email to confirm: `)
  if (normaliseEmail(answer) !== user.email) throw new Error(`Not deleted: you typed "${printable(answer.trim())}", not ${printable(user.email)}`)
  // This command cannot see the hub's containers, so it never removes a folder: it marks the user deleted and revokes
  // what the database holds; the running hub's sweep (within 15 seconds) blocks their workspaces, confirms them gone,
  // removes their folders and their rows (project-folders.ts).
  store.markUserDeleted(user.id)
  await revokeUser(offlineHub(store), user.id)
  store.requestCut(user.id, Date.now())
  store.audit({ time: Date.now(), userId: user.id, event: "account-deleted", address: "cli", detail: "by the maintainer" })
  io.out(`Deleted ${printable(user.email)}. The running hub stops their workspaces and removes their ${projects} project(s) with all files within 15 seconds (or when it next starts).`)
  return 0
}
