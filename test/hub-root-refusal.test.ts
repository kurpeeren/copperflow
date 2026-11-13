import { describe, expect, test } from "vitest"
import { mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ROOT_REFUSAL, runHubCommand } from "../src/hub/commands.js"

const out = () => ({ out: () => undefined, err: () => undefined })

describe("hub commands refuse to run as root", () => {
  const commands: [string, (data: string) => string[]][] = [
    ["invite", (data) => ["invite", "--data", data]],
    ["status", (data) => ["status", "--data", data]],
    ["reset-password", (data) => ["reset-password", "a@example.com", "--data", data]],
    ["delete-user", (data) => ["delete-user", "a@example.com", "--data", data]],
    ["stop-workspace", (data) => ["stop-workspace", "a".repeat(32), "--data", data]],
    ["backup", (data) => ["backup", "--data", data, "--to", join(data, "..", "x.db")]],
    ["check-data", (data) => ["check-data", "--data", data]],
    ["check-data --fix", (data) => ["check-data", "--data", data, "--fix"]],
    ["the hub itself", (data) => ["--data", data, "--port", "0", "--public-origin", "https://x.example.com", "--workspace-domain", "ws.x.example.com", "--trusted-accounts-only"]],
  ]

  for (const [name, args] of commands) {
    test(`${name} as uid 0 is refused with one line, and nothing is created`, async () => {
      const parent = await mkdtemp(join(tmpdir(), "cf-root-"))
      const data = join(parent, "data")
      await expect(runHubCommand(args(data), "/", out(), 0)).rejects.toThrow(ROOT_REFUSAL)
      expect(await readdir(parent)).toEqual([])
    })
  }

  test("the refusal is one line and names the fix", () => {
    expect(ROOT_REFUSAL).not.toContain("\n")
    expect(ROOT_REFUSAL).toContain("sudo -u <the hub's user> copperflow hub")
  })

  test("another uid, and no uid (Windows), run as before; help needs no data directory and is not refused", async () => {
    const parent = await mkdtemp(join(tmpdir(), "cf-root-"))
    const data = join(parent, "data")
    const lines: string[] = []
    expect(await runHubCommand(["status", "--data", data], "/", { out: (t) => lines.push(t), err: () => undefined }, 1000)).toBe(0)
    expect(lines[0]).toBe("Users: 0")
    expect(await runHubCommand(["status", "--data", join(parent, "other")], "/", out(), undefined)).toBe(0)
    expect(await runHubCommand(["--help"], "/", out(), 0)).toBe(0)
  })
})
