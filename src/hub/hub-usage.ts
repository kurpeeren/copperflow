// The options of `copperflow hub`, in one table: the parser's set of options without a value, the server's known
// options, the usage printed with every refusal and the text of `hub --help` are all made from it, so none of them can
// drift from another.

export const MAX_INVITES = 100

export interface HubOption {
  name: string
  /** The value's placeholder, e.g. "<dir>"; absent for an option that takes no value. */
  value?: string
  required?: boolean
  /** Only meaningful with this runner; the server refuses a container option under `--runner process`. */
  runner?: "container" | "process"
  note: string
}

export interface HubCommand {
  /** The word after `hub`; "" is the server itself. */
  name: string
  /** What follows the command word, e.g. "<email>". */
  positional?: string
  summary: string
  options: readonly HubOption[]
}

const DATA: HubOption = { name: "--data", value: "<dir>", required: true, note: "the hub's data directory" }

export const HUB_COMMANDS: readonly HubCommand[] = [
  {
    name: "",
    summary: "run the hub: accounts, projects and the Studio proxy",
    options: [
      DATA,
      { name: "--port", value: "<n>", required: true, note: "the port the hub listens on (0 to 65535)" },
      { name: "--public-origin", value: "<url>", required: true, note: "the address people use, e.g. https://copperflow.example.com" },
      { name: "--workspace-domain", value: "<domain>", required: true, note: "each project is served on its own origin under this domain, e.g. ws.copperflow.example.com" },
      { name: "--runner", value: "<container|process>", note: "how workspaces run (default process)" },
      { name: "--trusted-accounts-only", runner: "process", note: "required with the process runner: every account can read every other account's data, so use it for accounts you trust only" },
      { name: "--workspace-image", value: "<name>", runner: "container", note: "required with the container runner: the image built from deploy/workspace.Dockerfile" },
      { name: "--container-command", value: "<command>", runner: "container", note: "the container engine's command (default docker)" },
      { name: "--hub-container", value: "<name>", runner: "container", note: "with --workspace-reach network: the hub's own container" },
      { name: "--workspace-reach", value: "<loopback|network>", runner: "container", note: "how the hub reaches workspaces (default loopback)" },
      { name: "--workspace-group", value: "<gid>", runner: "container", note: "the group workspace files belong to" },
      { name: "--workspace-user-same-as-hub", runner: "container", note: "run workspaces as the hub's own user (a trial on your own machine only)" },
      { name: "--bind", value: "<address>", note: "the IP address to listen on (default 127.0.0.1)" },
      { name: "--trust-proxy", value: "<address|CIDR>", note: "a reverse proxy whose forwarded address is believed" },
      { name: "--tls-ask-weekly", value: "<n>", note: "new project-name certificates the proxy may be told to get per week, all users together (default 40; 0 approves none)" },
      { name: "--hsts-include-subdomains", note: "add includeSubDomains to the HSTS header" },
    ],
  },
  { name: "invite", summary: "make invite codes, shown once", options: [DATA, { name: "--count", value: "<n>", note: `how many codes, 1 to ${MAX_INVITES} (default 1)` }] },
  { name: "reset-password", positional: "<email>", summary: "set a one-time password and end the user's sessions", options: [DATA] },
  { name: "status", summary: "users, projects, running workspaces and disk use", options: [DATA, { name: "--json", note: "one JSON line for monitoring" }] },
  { name: "backup", summary: "copy the database to a new file", options: [DATA, { name: "--to", value: "<file>", required: true, note: "the file to write; it must not exist" }] },
  { name: "stop-workspace", positional: "<project id>", summary: "stop a project's workspace; its next request starts it again", options: [DATA] },
  {
    name: "check-data",
    summary: "check the owners and modes the hub relies on",
    options: [
      DATA,
      { name: "--workspace-group", value: "<gid>", note: "the group workspace files belong to (default: the hub's status file)" },
      { name: "--fix", note: "repair what this user may, with the hub stopped" },
      { name: "--no-workspaces-running", note: "with --fix and the process runner: vouch that no workspace process is left" },
    ],
  },
  { name: "delete-user", positional: "<email>", summary: "delete an account and its projects (asks to confirm)", options: [DATA] },
]

const ALL_OPTIONS: readonly HubOption[] = HUB_COMMANDS.flatMap((command) => command.options)

/** The options that take no value. */
export const VALUELESS_FLAGS: ReadonlySet<string> = new Set(ALL_OPTIONS.filter((option) => option.value === undefined).map((option) => option.name))

const SERVER = HUB_COMMANDS[0] as HubCommand

/** The options that take a value and belong to the server (the keys `parseServeArgs` accepts). */
export const SERVER_OPTIONS: readonly string[] = SERVER.options.filter((option) => option.value !== undefined).map((option) => option.name)

/** The options that take a value and belong to `--runner container`. */
export const CONTAINER_OPTIONS: readonly string[] = SERVER.options.filter((option) => option.runner === "container" && option.value !== undefined).map((option) => option.name)

export const hubCommandNamed = (name: string): HubCommand | undefined => HUB_COMMANDS.find((command) => command.name === name)

const shown = (option: HubOption): string => (option.value === undefined ? option.name : `${option.name} ${option.value}`)

/** `copperflow hub invite --data <dir> [--count <n>]` */
export function usageLine(command: HubCommand): string {
  const words = ["copperflow hub", ...(command.name === "" ? [] : [command.name]), ...(command.positional ? [command.positional] : [])]
  const options = command.options.map((option) => (option.required ? shown(option) : `[${shown(option)}]`))
  return [...words, ...options].join(" ")
}

/** What follows "Usage:" in a refusal: one line per command. */
export const USAGE: string = `Usage:\n${HUB_COMMANDS.map((command) => `  ${usageLine(command)}`).join("\n")}`

const WIDTH = 30

function optionLines(command: HubCommand): string[] {
  return command.options.map((option) => `    ${shown(option).padEnd(WIDTH)}${option.note}`)
}

/** The text of `hub --help` (every command) or `hub <command> --help` (one), as lines. */
export function helpLines(command?: HubCommand): string[] {
  const commands = command === undefined ? HUB_COMMANDS : [command]
  const lines = ["Usage:"]
  for (const each of commands) lines.push(`  ${usageLine(each)}`, `    ${each.summary}`, ...optionLines(each))
  if (command === undefined) lines.push("", "copperflow hub <command> --help shows one command.")
  return lines
}
