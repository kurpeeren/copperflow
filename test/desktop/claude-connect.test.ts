import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { claudeCodeCommand, claudeDesktopConfigFile, connectClaudeDesktop, mcpLaunch } from "../../src/desktop/index.js"

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cf-connect-"))
  file = join(dir, "Claude", "claude_desktop_config.json")
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const launch = mcpLaunch("C:\\Program Files\\copperflow\\copperflow.exe", "C:\\Program Files\\copperflow\\resources\\app")

describe("claudeDesktopConfigFile", () => {
  it("follows APPDATA on Windows", () => {
    const appData = "C:\\Users\\a\\AppData\\Roaming"
    expect(claudeDesktopConfigFile({ APPDATA: appData }, "win32")).toBe(join(appData, "Claude", "claude_desktop_config.json"))
  })
  it("uses Application Support on macOS and .config on Linux", () => {
    expect(claudeDesktopConfigFile({ HOME: "/h" }, "darwin")).toBe(join("/h", "Library", "Application Support", "Claude", "claude_desktop_config.json"))
    expect(claudeDesktopConfigFile({ HOME: "/h" }, "linux")).toBe(join("/h", ".config", "Claude", "claude_desktop_config.json"))
  })

  describe("on Windows, with Claude Desktop from the Microsoft Store", () => {
    const roaming = "C:\\Users\\a\\AppData\\Roaming"
    const local = "C:\\Users\\a\\AppData\\Local"
    const env = { APPDATA: roaming, LOCALAPPDATA: local }
    const storeFolder = (id: string) => join(local, "Packages", `Claude_${id}`, "LocalCache", "Roaming", "Claude")
    /** A directory lister over a made-up tree: each folder and the names in it. */
    const lister = (tree: Record<string, string[]>) => (dir: string) => tree[dir] ?? []

    it("uses the Store package's folder when %APPDATA%\\Claude is not there and one package is", () => {
      const list = lister({ [join(local, "Packages")]: ["Claude_pzs8sxrjxfjjc", "Other_1"], [join(local, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming")]: ["Claude"] })
      expect(claudeDesktopConfigFile(env, "win32", list)).toBe(join(storeFolder("pzs8sxrjxfjjc"), "claude_desktop_config.json"))
    })

    it("keeps %APPDATA%\\Claude when it exists, even with a Store package beside it", () => {
      const list = lister({ [roaming]: ["Claude"], [join(local, "Packages")]: ["Claude_x"], [join(local, "Packages", "Claude_x", "LocalCache", "Roaming")]: ["Claude"] })
      expect(claudeDesktopConfigFile(env, "win32", list)).toBe(join(roaming, "Claude", "claude_desktop_config.json"))
    })

    it("keeps %APPDATA%\\Claude when no package or more than one has the folder", () => {
      expect(claudeDesktopConfigFile(env, "win32", lister({}))).toBe(join(roaming, "Claude", "claude_desktop_config.json"))
      const two = lister({
        [join(local, "Packages")]: ["Claude_a", "Claude_b"],
        [join(local, "Packages", "Claude_a", "LocalCache", "Roaming")]: ["Claude"],
        [join(local, "Packages", "Claude_b", "LocalCache", "Roaming")]: ["Claude"],
      })
      expect(claudeDesktopConfigFile(env, "win32", two)).toBe(join(roaming, "Claude", "claude_desktop_config.json"))
      const empty = lister({ [join(local, "Packages")]: ["Claude_a"] })
      expect(claudeDesktopConfigFile(env, "win32", empty)).toBe(join(roaming, "Claude", "claude_desktop_config.json"))
    })

    it("reads real folders by default, and a missing one is no error", async () => {
      const appData = join(dir, "Roaming")
      const localData = join(dir, "Local")
      const store = join(localData, "Packages", "Claude_test", "LocalCache", "Roaming", "Claude")
      await mkdir(store, { recursive: true })
      expect(claudeDesktopConfigFile({ APPDATA: appData, LOCALAPPDATA: localData }, "win32")).toBe(join(store, "claude_desktop_config.json"))
    })
  })
})

describe("mcpLaunch", () => {
  it("runs the exe as plain node on the packaged cli", () => {
    expect(launch).toEqual({
      command: "C:\\Program Files\\copperflow\\copperflow.exe",
      args: [join("C:\\Program Files\\copperflow\\resources\\app", "dist", "cli.js"), "mcp"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    })
  })
})

describe("connectClaudeDesktop", () => {
  it("creates a missing file without a backup", async () => {
    const result = await connectClaudeDesktop(file, launch)
    expect(result.changed).toBe(true)
    expect(result.backup).toBeUndefined()
    expect(result.message).toMatch(/restart claude desktop/i)
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ mcpServers: { copperflow: launch } })
  })

  it("keeps other keys and servers and backs up the old file", async () => {
    await mkdir(join(dir, "Claude"))
    const before = { theme: "dark", mcpServers: { other: { command: "x", args: ["1"] } } }
    await writeFile(file, JSON.stringify(before))
    const result = await connectClaudeDesktop(file, launch)
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ theme: "dark", mcpServers: { other: before.mcpServers.other, copperflow: launch } })
    expect(result.backup).toBe(`${file}.copperflow-backup`)
    expect(JSON.parse(await readFile(result.backup!, "utf8"))).toEqual(before)
    expect(result.message).toContain(result.backup!)
  })

  it("keeps the person's original file in the backup when a later connect changes the entry again", async () => {
    await mkdir(join(dir, "Claude"))
    const original = '{"theme":"light"}'
    await writeFile(file, original)
    await connectClaudeDesktop(file, { ...launch, command: "old.exe" })
    const later = await connectClaudeDesktop(file, launch)
    expect(later.changed).toBe(true)
    expect(later.backup).toBe(`${file}.copperflow-backup`)
    expect(await readFile(later.backup!, "utf8")).toBe(original)
    expect(later.message).toContain(later.backup!)
    expect(JSON.parse(await readFile(file, "utf8")).mcpServers.copperflow.command).toBe(launch.command)
  })

  it("reports no change when the entry is already the same", async () => {
    await connectClaudeDesktop(file, launch)
    const again = await connectClaudeDesktop(file, launch)
    expect(again.changed).toBe(false)
    expect(again.backup).toBeUndefined()
  })

  it("replaces an entry that differs", async () => {
    await connectClaudeDesktop(file, { ...launch, command: "old.exe" })
    expect((await connectClaudeDesktop(file, launch)).changed).toBe(true)
    expect(JSON.parse(await readFile(file, "utf8")).mcpServers.copperflow.command).toBe(launch.command)
  })

  it("refuses a file that is not valid JSON and leaves it alone", async () => {
    await mkdir(join(dir, "Claude"))
    await writeFile(file, "{ broken")
    await expect(connectClaudeDesktop(file, launch)).rejects.toThrow(/not valid JSON/)
    expect(await readFile(file, "utf8")).toBe("{ broken")
  })

  it("refuses mcpServers that is not an object", async () => {
    await mkdir(join(dir, "Claude"))
    await writeFile(file, '{"mcpServers": []}')
    await expect(connectClaudeDesktop(file, launch)).rejects.toThrow(/not an object/)
  })

  it("reads a file that starts with a byte order mark", async () => {
    await mkdir(join(dir, "Claude"))
    await writeFile(file, '\uFEFF{"a":1}')
    await connectClaudeDesktop(file, launch)
    expect(JSON.parse(await readFile(file, "utf8")).a).toBe(1)
  })
})

describe("claudeCodeCommand", () => {
  it("quotes paths with spaces and passes the environment", () => {
    expect(claudeCodeCommand(launch)).toBe(
      `claude mcp add copperflow --env ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files\\copperflow\\copperflow.exe" "${launch.args[0]}" mcp`,
    )
  })
  it("leaves out --env when there is none", () => {
    expect(claudeCodeCommand({ command: "node", args: ["/a b/cli.js", "mcp"], env: {} })).toBe('claude mcp add copperflow -- "node" "/a b/cli.js" mcp')
  })
})
