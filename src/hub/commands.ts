// copperflow hub: the hub server, and the maintainer's commands that work on its data directory directly.
import { readFile } from "node:fs/promises"
import { prepareDataDir } from "./permissions.js"
import { join, resolve } from "node:path"
import { writeFileAtomic } from "../core/fs-utils.js"
import type { CliIO } from "../cli-commands.js"
import { removeUser } from "./account-routes.js"
import { ProjectFiles } from "./projects.js"
import { hashPassword, hashSecret, newSecret } from "./secrets.js"
import { sameSiteWarning, startHub, TRUSTED_ONLY_WARNING } from "./server.js"
import { HubStore, normaliseEmail } from "./store.js"
import type { WorkspaceRunner } from "./runner/runner.js"

export const STATUS_FILE = "hub-status.json"
const STATUS_EVERY_MS = 15_000
const STATUS_STALE_MS = 2 * 60_000
const MAX_INVITES = 100

const USAGE = `Usage:
  copperflow hub --data <dir> --port <n> --public-origin <url> --workspace-domain <domain> --trusted-accounts-only [--bind <address>] [--trust-proxy]
  copperflow hub invite --data <dir> [--count n]
  copperflow hub reset-password <email> --data <dir>
  copperflow hub status --data <dir>
  copperflow hub delete-user <email> --data <dir>`

/** Splits `--name value` options from the rest; `--trust-proxy` is the one flag. */
function parse(args: readonly string[]): { options: Map<string, string>; flags: Set<string>; rest: string[] } {
  const options = new Map<string, string>()
  const flags = new Set<string>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string
    if (arg === "--trust-proxy" || arg === "--trusted-accounts-only") flags.add(arg)
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

async function serve(options: Map<string, string>, flags: Set<string>, cwd: string, io: CliIO): Promise<number> {
  const dataDir = dataDirOf(options, cwd)
  const port = Number(options.get("--port"))
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`--port must be a port number.\n${USAGE}`)
  const publicOrigin = options.get("--public-origin")
  if (!publicOrigin) throw new Error(`Missing --public-origin <url>.\n${USAGE}`)
  const trustedAccountsOnly = flags.has("--trusted-accounts-only")
  const workspaceDomain = options.get("--workspace-domain")
  if (!workspaceDomain) throw new Error(`Missing --workspace-domain <domain>: each project is served on its own origin under it.\n${USAGE}`)
  const hub = await startHub({ dataDir, port, publicOrigin, workspaceDomain, bind: options.get("--bind") ?? "127.0.0.1", trustProxy: flags.has("--trust-proxy"), trustedAccountsOnly })
  if (trustedAccountsOnly) io.out(TRUSTED_ONLY_WARNING)
  const siteWarning = sameSiteWarning(publicOrigin, workspaceDomain)
  if (siteWarning) io.out(siteWarning)
  const writeStatus = () =>
    writeFileAtomic(join(dataDir, STATUS_FILE), `${JSON.stringify({ updated: Date.now(), pid: process.pid, running: hub.hub.runner.running() })}\n`).catch((error: unknown) =>
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

async function resetPassword(store: HubStore, email: string | undefined, io: CliIO): Promise<number> {
  if (!email) throw new Error(`Missing the email.\n${USAGE}`)
  const user = store.userByEmail(email)
  if (!user) throw new Error(`There is no user with the email ${normaliseEmail(email)}`)
  const password = newSecret()
  store.setPassword(user.id, await hashPassword(password), true)
  store.endSessions(user.id)
  store.forgetDevices(user.id)
  store.requestCut(user.id, Date.now())
  store.audit({ time: Date.now(), userId: user.id, event: "password-reset", address: "cli", detail: "" })
  io.out(`A one-time password for ${user.email}, shown only now. Every session of the user has ended; they must choose a new password when they next sign in:`)
  io.out(password)
  return 0
}

async function status(store: HubStore, dataDir: string, io: CliIO): Promise<number> {
  const counts = store.counts()
  const bytes = (await new ProjectFiles(dataDir).list(join(dataDir, "projects"))).reduce((sum, file) => sum + file.size, 0)
  let running = "unknown (the hub is not running, or has not written its status in the last 2 minutes)"
  try {
    const written = JSON.parse(await readFile(join(dataDir, STATUS_FILE), "utf8")) as { updated?: unknown; running?: unknown }
    if (typeof written.updated === "number" && typeof written.running === "number" && Date.now() - written.updated < STATUS_STALE_MS) running = String(written.running)
  } catch {
    // No status file yet: the hub has not run.
  }
  io.out(`Users: ${counts.users}`)
  io.out(`Projects: ${counts.projects}`)
  io.out(`Unused invite codes: ${counts.unusedInvites}`)
  io.out(`Running workspaces: ${running}`)
  io.out(`Disk used by projects: ${(bytes / (1024 * 1024)).toFixed(1)} MB`)
  return 0
}

async function deleteUser(store: HubStore, dataDir: string, email: string | undefined, io: CliIO): Promise<number> {
  if (!email) throw new Error(`Missing the email.\n${USAGE}`)
  const user = store.userByEmail(email)
  if (!user) throw new Error(`There is no user with the email ${normaliseEmail(email)}`)
  if (!io.ask) throw new Error("hub delete-user must be run by a person in an interactive terminal")
  const projects = store.projectCount(user.id)
  const answer = await io.ask(`This deletes ${user.email}, their sessions and ${projects} project(s) with all files. Type the email to confirm: `)
  if (normaliseEmail(answer) !== user.email) throw new Error(`Not deleted: you typed "${answer.trim()}", not ${user.email}`)
  await removeUser({ store, files: new ProjectFiles(dataDir), runner: NO_RUNNER, userCuts: new Map(), epochs: new Map() }, user.id)
  // The running hub cuts their streams and stops their workspaces at its next sweep (within 15 seconds).
  store.requestCut(user.id, Date.now())
  store.audit({ time: Date.now(), userId: user.id, event: "account-deleted", address: "cli", detail: "by the maintainer" })
  io.out(`Deleted ${user.email} and ${projects} project(s). A running hub cuts their open streams and stops their workspaces within 15 seconds.`)
  return 0
}
