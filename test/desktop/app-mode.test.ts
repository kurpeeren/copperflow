import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { appMode } from "../../src/desktop/index.js"
import { cliCommandNames } from "../../src/cli-help.js"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cf-mode-"))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const EXE = "C:\\Program Files\\copperflow\\copperflow.exe"

describe("appMode", () => {
  it("shows the window when started with nothing", () => {
    expect(appMode([EXE])).toEqual({ kind: "window" })
    expect(appMode([])).toEqual({ kind: "window" })
  })

  it("ignores the dot of electron . and Chromium or Windows switches", () => {
    expect(appMode(["electron.exe", ".", "--allow-file-access-from-files", "--no-sandbox"])).toEqual({ kind: "window" })
    expect(appMode([EXE, "--inspect=5858", "--squirrel-firstrun"])).toEqual({ kind: "window" })
  })

  it("opens a folder or a circuit file given as the only argument", async () => {
    await mkdir(join(dir, "proj"))
    expect(appMode([EXE, join(dir, "proj")])).toEqual({ kind: "window", open: join(dir, "proj") })
    const circuit = join(dir, "a.circuit.tsx")
    expect(appMode([EXE, circuit])).toEqual({ kind: "window", open: circuit })
    expect(appMode([EXE, "--no-sandbox", join(dir, "proj")])).toEqual({ kind: "window", open: join(dir, "proj") })
  })

  it("runs the command line for commands", () => {
    expect(appMode([EXE, "mcp"])).toEqual({ kind: "cli", args: ["mcp"] })
    expect(appMode([EXE, "studio", "--port", "4800"])).toEqual({ kind: "cli", args: ["studio", "--port", "4800"] })
    expect(appMode([EXE, "help"])).toEqual({ kind: "cli", args: ["help"] })
    expect(appMode([EXE, "connect", "claude-code"])).toEqual({ kind: "cli", args: ["connect", "claude-code"] })
    expect(appMode([EXE, "--root", "x", "check", "a.circuit.tsx"])).toEqual({ kind: "cli", args: ["--root", "x", "check", "a.circuit.tsx"] })
  })

  it("sends something that is neither a command nor a path to the command line, which reports it", () => {
    expect(appMode([EXE, "nonsense"])).toEqual({ kind: "cli", args: ["nonsense"] })
  })
})

describe("cliCommandNames", () => {
  it("lists every command the command line handles", () => {
    const source = readFileSync(new URL("../../src/cli-commands.ts", import.meta.url), "utf8")
    const handled = [...source.matchAll(/^ {6}case "([a-z-]+)":/gm)].map((m) => m[1]!).filter((name) => name !== "--help")
    const known = cliCommandNames()
    for (const name of handled) expect(known, name).toContain(name)
  })
})
