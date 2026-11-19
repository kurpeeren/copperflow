import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { connectCommand } from "../../src/cli-connect.js"
import { runCli } from "../../src/cli-commands.js"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cf-cmd-"))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const launch = { command: "node", args: ["/pkg/dist/cli.js", "mcp"], env: {} }

describe("connect command", () => {
  it("writes the Claude Desktop config", async () => {
    const configFile = join(dir, "c.json")
    expect(await connectCommand(["claude-desktop"], { launch, configFile })).toMatch(/Restart Claude Desktop/)
    expect(JSON.parse(await readFile(configFile, "utf8")).mcpServers.copperflow).toEqual(launch)
  })

  it("prints the Claude Code command and writes nothing", async () => {
    expect(await connectCommand(["claude-code"], { launch })).toContain('claude mcp add copperflow -- "node" "/pkg/dist/cli.js" mcp')
  })

  it("refuses a missing or unknown target", async () => {
    await expect(connectCommand([], { launch })).rejects.toThrow(/Missing the target/)
    await expect(connectCommand(["claude-web"], { launch })).rejects.toThrow(/Unknown target/)
  })

  it("is reachable through runCli and listed in the help", async () => {
    const out: string[] = []
    const err: string[] = []
    const io = { out: (t: string) => out.push(t), err: (t: string) => err.push(t) }
    expect(await runCli(["connect", "claude-code"], dir, io)).toBe(0)
    expect(out[0]).toContain("claude mcp add copperflow")
    expect(await runCli(["connect"], dir, io)).toBe(1)
    out.length = 0
    await runCli(["help"], dir, io)
    expect(out[0]).toContain("copperflow connect claude-desktop")
  })
})
