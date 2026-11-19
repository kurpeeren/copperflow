// `copperflow connect claude-desktop` and `copperflow connect claude-code`, for installs from npm.
import { fileURLToPath } from "node:url"
import { claudeCodeCommand, claudeDesktopConfigFile, connectClaudeDesktop, nodeLaunch, type McpLaunch } from "./desktop/claude-connect.js"

const USAGE = "Usage: copperflow connect claude-desktop | claude-code"

export interface ConnectOptions {
  /** How the Claude apps start copperflow; the node running this and this package's cli.js when left out. */
  launch?: McpLaunch
  /** Claude Desktop's settings file; its usual place when left out. Tests pass a file in a temporary folder. */
  configFile?: string
}

function installedLaunch(): McpLaunch {
  return nodeLaunch(process.execPath, fileURLToPath(new URL("./cli.js", import.meta.url)))
}

/** Connects a Claude app only when the person runs this command; nothing connects by itself. */
export async function connectCommand(rest: string[], options: ConnectOptions = {}): Promise<string> {
  const [target, ...extra] = rest
  if (extra.length > 0) throw new Error(`connect takes one target. ${USAGE}`)
  const launch = options.launch ?? installedLaunch()
  if (target === "claude-code") return `Run this command to add copperflow to Claude Code:\n${claudeCodeCommand(launch)}`
  if (target === "claude-desktop") return (await connectClaudeDesktop(options.configFile ?? claudeDesktopConfigFile(), launch)).message
  throw new Error(target === undefined ? `Missing the target. ${USAGE}` : `Unknown target "${target}". ${USAGE}`)
}
