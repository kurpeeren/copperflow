// copperflow hub: the hub server, and the maintainer's commands that work on its data directory directly.
import { spawn as nodeSpawn } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { prepareDataDir } from "./permissions.js"
import { join, resolve } from "node:path"
import { writeFileAtomic } from "../core/fs-utils.js"
import type { CliIO } from "../cli-commands.js"
import { AgentSessions } from "./agent-sessions.js"
import { OAuthState } from "./oauth-state.js"
import { revokeUser, type RevokingHub } from "./revocation.js"
import { measureTree } from "./safe-files.js"
import { hashPassword, hashSecret, newSecret } from "./secrets.js"
import { sameSiteWarning, startHub, TRUSTED_ONLY_WARNING, type HubOptions } from "./server.js"
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
  type SpawnLike,
} from "./runner/container-runner.js"

export const STATUS_FILE = "hub-status.json"
const STATUS_EVERY_MS = 15_000
const STATUS_STALE_MS = 2 * 60_000
const MAX_INVITES = 100

const USAGE = `Usage:
  copperflow hub --data <dir> --port <n> --public-origin <url> --workspace-domain <domain> --runner container --workspace-image <name>
                 [--container-command docker] [--workspace-reach loopback | --workspace-reach network --hub-container <name>] --workspace-group <gid> [--workspace-user-same-as-hub] [--bind <address>] [--trust-proxy <address|CIDR>]
  copperflow hub --data <dir> --port <n> --public-origin <url> --workspace-domain <domain> --runner process --trusted-accounts-only [--bind <address>] [--trust-proxy <address|CIDR>]
  copperflow hub invite --data <dir> [--count n]
  copperflow hub reset-password <email> --data <dir>
  copperflow hub status --data <dir>
  copperflow hub delete-user <email> --data <dir>`

/** Splits `--name value` options from the rest; `--trusted-accounts-only` is the one flag. */
function parse(args: readonly string[]): { options: Map<string, string>; flags: Set<string>; rest: string[] } {
  const options = new Map<string, string>()
  const flags = new Set<string>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string
    if (arg === "--trusted-accounts-only" || arg === "--workspace-user-same-as-hub") flags.add(arg)
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

export async function runHubCommand(args: string[], cwd: string, io: CliIO): Promise<number> {
  const { options, flags, rest } = parse(args)
  const [command, email] = rest
  if (command === undefined) return serve(options, flags, cwd, io)
  const dataDir = dataDirOf(options, cwd)
  const store = await openStore(dataDir)
  try {
    switch (command) {
      case "invite":
        return invite(store, options, io)
      case "reset-password":
        return await resetPassword(store, email, io)
      case "status":
        return await status(store, dataDir, io)
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

const CONTAINER_OPTIONS = ["--workspace-image", "--container-command", "--hub-container", "--workspace-reach", "--workspace-group"]

/** Said at start with --workspace-user-same-as-hub. */
export const SAME_USER_WARNING =
  "Warning: --workspace-user-same-as-hub runs workspaces as the hub's own user, so a container escape would run as the hub's user and could read its keys and database. Use it only for a trial on your own machine; give strangers' accounts --workspace-group instead."

/** The runner the flags ask for: `--runner process` (the default, as before) or `--runner container`. */
export function chooseRunner(options: Map<string, string>, flags: Set<string>): RunnerChoice {
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
  checkSettings(settings)
  return { kind, settings }
}

/** With the container runner: the engine is checked and last run's leftovers swept before the hub listens. */
export async function runnerFor(choice: RunnerChoice, io: CliIO, spawn?: SpawnLike): Promise<Pick<HubOptions, "runner" | "trustedAccountsOnly" | "workspaceGroup">> {
  if (choice.kind === "process") return { trustedAccountsOnly: choice.trustedAccountsOnly }
  for (const warning of await checkEngine(choice.settings, spawn)) io.out(warning)
  if (choice.settings.sameUserAsHub) io.out(SAME_USER_WARNING)
  io.out(await engineModeLine(choice.settings, spawn))
  const removed = await sweepLeftovers(choice.settings, spawn, (line) => io.out(line))
  if (removed > 0) io.out(`Removed ${removed} workspace container(s) left from an earlier run.`)
  return {
    runner: (ticketPublicKey) => createContainerRunner({ ...choice.settings, ticketPublicKey, ...(spawn ? { spawn } : {}) }),
    ...(choice.settings.group && !choice.settings.sameUserAsHub ? { workspaceGroup: Number(choice.settings.group) } : {}),
  }
}

async function serve(options: Map<string, string>, flags: Set<string>, cwd: string, io: CliIO): Promise<number> {
  const dataDir = dataDirOf(options, cwd)
  const port = Number(options.get("--port"))
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port must be a port number.\n${USAGE}`)
  const publicOrigin = options.get("--public-origin")
  if (!publicOrigin) throw new Error(`Missing --public-origin <url>.\n${USAGE}`)
  const choice = chooseRunner(options, flags)
  if (choice.kind === "container") checkDataDirForMounts(dataDir)
  const workspaceDomain = options.get("--workspace-domain")
  if (!workspaceDomain) throw new Error(`Missing --workspace-domain <domain>: each project is served on its own origin under it.\n${USAGE}`)
  const runner = await runnerFor(choice, io)
  const hub = await startHub({ dataDir, port, publicOrigin, workspaceDomain, bind: options.get("--bind") ?? "127.0.0.1", ...(options.has("--trust-proxy") ? { trustProxy: options.get("--trust-proxy") as string } : {}), ...runner })
  if (choice.kind === "process" && choice.trustedAccountsOnly) io.out(TRUSTED_ONLY_WARNING)
  const siteWarning = sameSiteWarning(publicOrigin, workspaceDomain)
  if (siteWarning) io.out(siteWarning)
  const runnerStatus = choice.kind === "container" ? { runner: "container", command: choice.settings.command ?? DEFAULT_CONTAINER_COMMAND } : { runner: "process" }
  const writeStatus = () =>
    writeFileAtomic(join(dataDir, STATUS_FILE), `${JSON.stringify({ updated: Date.now(), pid: process.pid, running: hub.hub.runner.running(), ...runnerStatus })}\n`).catch((error: unknown) =>
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
    process.stderr.write(`copperflow hub: ${event}: ${name}${code ? ` ${code}` : ""}\n`)
  }
  on.on("unhandledRejection", (error: unknown) => record("hub-unhandled-rejection", error))
  on.on("uncaughtException", (error: unknown) => {
    record("hub-uncaught-exception", error)
    stop()
  })
}

function invite(store: HubStore, options: Map<string, string>, io: CliIO): number {
  const count = Number(options.get("--count") ?? "1")
  if (!Number.isInteger(count) || count < 1 || count > MAX_INVITES) throw new Error(`--count must be a whole number from 1 to ${MAX_INVITES}`)
  const codes = Array.from({ length: count }, () => newSecret())
  for (const code of codes) store.addInvite(hashSecret(code), Date.now())
  store.audit({ time: Date.now(), userId: null, event: "invites-made", address: "cli", detail: String(count) })
  io.out(`${count === 1 ? "An invite code" : `${count} invite codes`}, shown only now (the hub keeps only their hashes):`)
  for (const code of codes) io.out(code)
  io.out(TRUSTED_ONLY_WARNING)
  return 0
}

/** What a maintainer's command, in its own process, can revoke: the database; the running hub does the rest. */
function offlineHub(store: HubStore): RevokingHub {
  return { store, agents: new AgentSessions(), oauth: new OAuthState(), runner: NO_RUNNER, userCuts: new Map(), epochs: new Map() }
}

async function resetPassword(store: HubStore, email: string | undefined, io: CliIO): Promise<number> {
  if (!email) throw new Error(`Missing the email.\n${USAGE}`)
  const user = store.userByEmail(email)
  if (!user) throw new Error(`There is no user with the email ${normaliseEmail(email)}`)
  const password = newSecret()
  store.setPassword(user.id, await hashPassword(password), true)
  await revokeUser(offlineHub(store), user.id)
  // The running hub repeats the revocation at its next sweep, with what only it holds (agent sessions, streams).
  store.requestCut(user.id, Date.now())
  store.audit({ time: Date.now(), userId: user.id, event: "password-reset", address: "cli", detail: "" })
  io.out(`A one-time password for ${user.email}, shown only now. Every session of the user has ended; they must choose a new password when they next sign in:`)
  io.out(password)
  return 0
}

async function status(store: HubStore, dataDir: string, io: CliIO): Promise<number> {
  const counts = store.counts()
  // lstat only, never opening a file (workspaces may be running), with a generous cap for the whole tree.
  const measured = await measureTree(join(dataDir, "projects"), { maxEntries: 5_000_000, maxMs: 60_000 })
  let running = "unknown (the hub is not running, or has not written its status in the last 2 minutes)"
  let runner = "unknown"
  let engine: string | undefined
  try {
    const written = JSON.parse(await readFile(join(dataDir, STATUS_FILE), "utf8")) as { updated?: unknown; running?: unknown; runner?: unknown; command?: unknown }
    if (typeof written.updated === "number" && typeof written.running === "number" && Date.now() - written.updated < STATUS_STALE_MS) {
      running = String(written.running)
      if (written.runner === "process" || written.runner === "container") runner = written.runner
      // Only the two known engine names are taken from the file and run.
      if (written.runner === "container" && (written.command === "docker" || written.command === "podman")) engine = written.command
    }
  } catch {
    // No status file yet: the hub has not run.
  }
  io.out(`Users: ${counts.users}`)
  io.out(`Projects: ${counts.projects}`)
  io.out(`Unused invite codes: ${counts.unusedInvites}`)
  io.out(`Runner: ${runner}`)
  io.out(`Running workspaces: ${running}`)
  if (engine) for (const line of await containerMemory(engine)) io.out(`  ${line}`)
  const trash = await readdir(join(dataDir, "trash")).catch(() => [] as string[])
  if (trash.length > 0) io.out(`Trash not yet removed: ${trash.length} folder(s) (still counted in their users' usage; the hub retries every 5 seconds)`)
  io.out(`Disk used by projects: ${"bytes" in measured ? `${(measured.bytes / (1024 * 1024)).toFixed(1)} MB` : `unknown (${measured.failed})`}`)
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
    .map(([name, usage]) => `${name}: ${(usage as string).replace(/[^0-9A-Za-z./ ]/g, "").slice(0, 60)}`)
}

async function deleteUser(store: HubStore, dataDir: string, email: string | undefined, io: CliIO): Promise<number> {
  if (!email) throw new Error(`Missing the email.\n${USAGE}`)
  const user = store.userByEmail(email)
  if (!user) throw new Error(`There is no user with the email ${normaliseEmail(email)}`)
  if (!io.ask) throw new Error("hub delete-user must be run by a person in an interactive terminal")
  const projects = store.projectCount(user.id)
  const answer = await io.ask(`This deletes ${user.email}, their sessions and ${projects} project(s) with all files. Type the email to confirm: `)
  if (normaliseEmail(answer) !== user.email) throw new Error(`Not deleted: you typed "${answer.trim()}", not ${user.email}`)
  // This command cannot see the hub's containers, so it never removes a folder: it marks the user deleted and revokes
  // what the database holds; the running hub's sweep (within 15 seconds) blocks their workspaces, confirms them gone,
  // removes their folders and their rows (project-folders.ts).
  store.markUserDeleted(user.id)
  await revokeUser(offlineHub(store), user.id)
  store.requestCut(user.id, Date.now())
  store.audit({ time: Date.now(), userId: user.id, event: "account-deleted", address: "cli", detail: "by the maintainer" })
  io.out(`Deleted ${user.email}. The running hub stops their workspaces and removes their ${projects} project(s) with all files within 15 seconds (or when it next starts).`)
  return 0
}
