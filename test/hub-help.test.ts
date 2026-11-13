import { describe, expect, test } from "vitest"
import { existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { requireSqlite, runCli, type CliIO } from "../src/cli-commands.js"
import { parseServeArgs } from "../src/hub/commands.js"
import { CONTAINER_OPTIONS, HUB_COMMANDS, SERVER_OPTIONS, USAGE, VALUELESS_FLAGS } from "../src/hub/hub-usage.js"
import { printable } from "../src/hub/printable.js"

function io(): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, out: (text) => lines.push(text), err: (text) => errors.push(text) }
}

const optionsIn = (text: string) => new Set(text.match(/--[a-z][a-z-]*/g) ?? [])
const tableOptions = new Set(HUB_COMMANDS.flatMap((command) => command.options.map((option) => option.name)))

describe("hub --help", () => {
  test("hub --help, hub -h and hub help print every command and every option of the table, and exit 0", async () => {
    await requireSqlite()
    for (const args of [["hub", "--help"], ["hub", "-h"], ["hub", "help"]]) {
      const out = io()
      expect(await runCli(args, "/", out), args.join(" ")).toBe(0)
      expect(out.errors).toEqual([])
      const text = out.lines.join("\n")
      expect(text).toMatch(/^Usage:/)
      for (const command of HUB_COMMANDS) if (command.name !== "") expect(text).toContain(`copperflow hub ${command.name}`)
      // Every option of the real tables is listed, and nothing else that looks like an option.
      expect(optionsIn(text)).toEqual(new Set([...tableOptions, "--help"]))
      for (const line of out.lines) expect(printable(line, 1000)).toBe(line)
    }
  })

  test("hub <command> --help and hub help <command> print that command's usage only and read no data directory", async () => {
    await requireSqlite()
    const nowhere = join(await mkdtemp(join(tmpdir(), "cf-hub-help-")), "no-data-here")
    for (const args of [["hub", "invite", "--help"], ["hub", "invite", "--data", nowhere, "-h"], ["hub", "help", "invite"]]) {
      const out = io()
      expect(await runCli(args, "/", out), args.join(" ")).toBe(0)
      const text = out.lines.join("\n")
      expect(text).toContain("copperflow hub invite --data <dir> [--count <n>]")
      expect(optionsIn(text)).toEqual(new Set(["--data", "--count"]))
      expect(text).not.toContain("--port")
    }
    expect(existsSync(nowhere)).toBe(false)
    const status = io()
    expect(await runCli(["hub", "status", "--help"], "/", status)).toBe(0)
    expect(optionsIn(status.lines.join("\n"))).toEqual(new Set(["--data", "--json"]))
    const server = io()
    expect(await runCli(["hub", "--data", nowhere, "--help"], "/", server)).toBe(0)
    expect(server.lines.join("\n")).toContain("--public-origin <url>")
  })

  test("unknown commands and unknown flags are still refused", async () => {
    await requireSqlite()
    const unknownCommand = io()
    expect(await runCli(["hub", "frobnicate", "--help"], "/", unknownCommand)).toBe(1)
    expect(unknownCommand.errors.join("\n")).toContain('Unknown hub command "frobnicate"')
    const helpOf = io()
    expect(await runCli(["hub", "help", "frobnicate"], "/", helpOf)).toBe(1)
    const noValue = io()
    expect(await runCli(["hub", "--frobnicate"], "/", noValue)).toBe(1)
    expect(noValue.errors.join("\n")).toContain("Missing --frobnicate value")
    const unknownOption = io()
    expect(await runCli(["hub", "--frobnicate", "x", "--data", "d", "--port", "1", "--public-origin", "https://a.example", "--workspace-domain", "ws.a.example"], "/", unknownOption)).toBe(1)
    expect(unknownOption.errors.join("\n")).toContain("Unknown option --frobnicate")
    // The usage a refusal prints comes from the same table.
    expect(unknownOption.errors.join("\n")).toContain(USAGE)
  })

  test("the parser's option sets are the table's: flags take no value, container options belong to --runner container", () => {
    expect([...VALUELESS_FLAGS].sort()).toEqual(["--fix", "--hsts-include-subdomains", "--json", "--no-workspaces-running", "--trusted-accounts-only", "--workspace-user-same-as-hub"])
    expect(SERVER_OPTIONS).toContain("--runner")
    expect(CONTAINER_OPTIONS).toEqual(["--workspace-image", "--container-command", "--hub-container", "--workspace-reach", "--workspace-group"])
    // A flag from the table parses without a value; a container option under the process runner is refused.
    const base = ["--data", "d", "--port", "4790", "--public-origin", "https://a.example", "--workspace-domain", "ws.a.example", "--runner", "process", "--trusted-accounts-only"]
    expect(parseServeArgs([...base, "--hsts-include-subdomains"], "/").hstsIncludeSubdomains).toBe(true)
    expect(() => parseServeArgs([...base, "--workspace-image", "x"], "/")).toThrow(/belongs to --runner container/)
  })

  test("every option line keeps at least two spaces before its note, however long the option is", async () => {
    await requireSqlite()
    const out = io()
    expect(await runCli(["hub", "--help"], "/", out)).toBe(0)
    const optionLines = out.lines.filter((line) => line.startsWith("    --"))
    expect(optionLines.length).toBe(HUB_COMMANDS.reduce((sum, command) => sum + command.options.length, 0))
    for (const line of optionLines) expect(line, line).toMatch(/^ {4}--\S+(?: <[^>]+>)? {2,}\S/)
    expect(out.lines.some((line) => line.includes("--workspace-reach <loopback|network>  how"))).toBe(true)
  })

  test("the usage in every refusal says which option each runner needs, from the table", () => {
    expect(USAGE).toContain("--workspace-image <name> (required with --runner container)")
    expect(USAGE).toContain("--trusted-accounts-only (required with --runner process)")
    expect(USAGE).not.toContain("[--workspace-image")
    expect(USAGE).toContain("[--bind <address>]")
  })
})
