import { readdirSync } from "node:fs"
import { constants, copyFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { writeFileAtomic } from "./atomic-write.js"

export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

const SERVER_NAME = "copperflow"
const BACKUP_SUFFIX = ".copperflow-backup"
const RESTART_NOTE = "Restart Claude Desktop to see it."
const PLAIN_VALUE = /^[\w.:=-]+$/

const CONFIG_NAME = "claude_desktop_config.json"
const APP_FOLDER = "Claude"
/** The Microsoft Store installs Claude Desktop as a package named `Claude_<publisher id>`. */
const STORE_PACKAGE_PREFIX = "claude_"

/** The names in a folder; none when it is not there. */
export type ListFolder = (dir: string) => string[]

function listFolder(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // A folder that is not there is the answer "nothing here"; any other failure is real and is not hidden.
    if (code === "ENOENT" || code === "ENOTDIR") return []
    throw error
  }
}

const hasName = (names: string[], name: string) => names.some((one) => one.toLowerCase() === name.toLowerCase())

/**
 * Claude Desktop from the Microsoft Store keeps its files in its package's
 * `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude`: that folder when exactly one package has it.
 */
function storeFolder(env: NodeJS.ProcessEnv, list: ListFolder): string | undefined {
  const packages = join(env.LOCALAPPDATA ?? join(env.USERPROFILE ?? env.HOME ?? ".", "AppData", "Local"), "Packages")
  const found = list(packages)
    .filter((name) => name.toLowerCase().startsWith(STORE_PACKAGE_PREFIX))
    .map((name) => join(packages, name, "LocalCache", "Roaming"))
    .filter((roaming) => hasName(list(roaming), APP_FOLDER))
  return found.length === 1 ? join(found[0] as string, APP_FOLDER) : undefined
}

/**
 * Where Claude Desktop keeps its settings on this system. On Windows that is `%APPDATA%\Claude`; when that folder is
 * not there, the Microsoft Store install's folder is used if there is exactly one. `list` reads a folder's names.
 */
export function claudeDesktopConfigFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, list: ListFolder = listFolder): string {
  if (platform === "win32") {
    const base = env.APPDATA ?? join(env.USERPROFILE ?? env.HOME ?? ".", "AppData", "Roaming")
    const classic = join(base, APP_FOLDER)
    const folder = hasName(list(base), APP_FOLDER) ? classic : (storeFolder(env, list) ?? classic)
    return join(folder, CONFIG_NAME)
  }
  const home = env.HOME ?? "."
  if (platform === "darwin") return join(home, "Library", "Application Support", APP_FOLDER, CONFIG_NAME)
  return join(env.XDG_CONFIG_HOME ?? join(home, ".config"), APP_FOLDER, CONFIG_NAME)
}

/**
 * The packaged app as an MCP server. ELECTRON_RUN_AS_NODE makes the exe behave as plain Node (no window, no browser
 * engine), which is how an Electron app offers a command line.
 */
export function mcpLaunch(exePath: string, appDir: string): McpLaunch {
  return { command: exePath, args: [join(appDir, "dist", "cli.js"), "mcp"], env: { ELECTRON_RUN_AS_NODE: "1" } }
}

/** An install from npm: the node that runs this, this package's cli.js. */
export function nodeLaunch(nodeExe: string, cliJs: string): McpLaunch {
  return { command: nodeExe, args: [cliJs, "mcp"], env: {} }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Equal when they hold the same data, whatever the order of keys. */
function sameData(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => sameData(item, b[i]))
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameData(a[key], b[key]))
  }
  return a === b
}

async function readConfig(configFile: string): Promise<{ config: Record<string, unknown>; existed: boolean }> {
  let text: string
  try {
    text = await readFile(configFile, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: {}, existed: false }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""))
  } catch {
    throw new Error(`${configFile} is not valid JSON, so it was left alone. Fix or remove it, then connect again.`)
  }
  if (!isPlainObject(parsed)) throw new Error(`${configFile} does not hold a JSON object, so it was left alone.`)
  return { config: parsed, existed: true }
}

/**
 * Copies the person's file to `backup` unless a backup is there already: that one holds the file as it was before
 * copperflow first changed it, and a later connect must not replace it with the already changed file. Answers
 * whether this call made it.
 */
async function backUpOnce(configFile: string, backup: string): Promise<boolean> {
  try {
    await copyFile(configFile, backup, constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
    throw error
  }
}

/**
 * Adds copperflow to Claude Desktop's MCP servers and keeps every other key and server. A file that is not valid
 * JSON is refused (an error), never overwritten. The person's original file is copied to `<file>.copperflow-backup`
 * the first time; that backup is kept from then on.
 */
export async function connectClaudeDesktop(configFile: string, launch: McpLaunch): Promise<{ changed: boolean; backup?: string; message: string }> {
  const { config, existed } = await readConfig(configFile)
  const servers = config.mcpServers
  if (servers !== undefined && !isPlainObject(servers)) throw new Error(`"mcpServers" in ${configFile} is not an object, so the file was left alone.`)
  if (sameData(servers?.[SERVER_NAME], launch)) return { changed: false, message: `copperflow is already connected in ${configFile}.` }
  const next = { ...config, mcpServers: { ...servers, [SERVER_NAME]: launch } }
  const message = `Connected copperflow in ${configFile}.`
  if (!existed) {
    await writeFileAtomic(configFile, `${JSON.stringify(next, null, 2)}\n`)
    return { changed: true, message: `${message} ${RESTART_NOTE}` }
  }
  const backup = `${configFile}${BACKUP_SUFFIX}`
  const made = await backUpOnce(configFile, backup)
  await writeFileAtomic(configFile, `${JSON.stringify(next, null, 2)}\n`)
  const kept = made ? `The file as it was is kept in ${backup}.` : `The file as it was before copperflow first changed it is kept in ${backup}.`
  return { changed: true, backup, message: `${message} ${kept} ${RESTART_NOTE}` }
}

/** Double quotes work for Windows paths with spaces and for POSIX shells alike; a quote inside is escaped. */
function quote(text: string): string {
  return `"${text.replaceAll('"', '\\"')}"`
}

/** The one line that adds copperflow to Claude Code; it is shown to the person, never run. */
export function claudeCodeCommand(launch: McpLaunch): string {
  const env = Object.entries(launch.env).map(([key, value]) => `--env ${PLAIN_VALUE.test(value) ? `${key}=${value}` : quote(`${key}=${value}`)}`)
  const args = launch.args.map((arg) => (/^[a-z]+$/i.test(arg) ? arg : quote(arg)))
  return ["claude mcp add", SERVER_NAME, ...env, "--", quote(launch.command), ...args].join(" ")
}
