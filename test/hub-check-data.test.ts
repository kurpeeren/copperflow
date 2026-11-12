// `copperflow hub check-data`: the ownership and mode invariants the hub relies on, after a restore or a manual change.
import { describe, expect, test } from "vitest"
import { chmod, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli, type CliIO } from "../src/cli-commands.js"
import { STATUS_FILE } from "../src/hub/commands.js"
import { loadOrCreateTicketKey } from "../src/hub/keys.js"
import { prepareDataDir } from "../src/hub/permissions.js"
import { HubStore } from "../src/hub/store.js"

function io(): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, out: (text) => lines.push(text), err: (text) => errors.push(text) }
}

const POSIX = process.platform !== "win32"
if (!POSIX) process.stdout.write("hub-check-data.test.ts: the ownership and mode checks are skipped on Windows (no POSIX owners or modes); only the Windows answer is tested.\n")

/** A data directory as the hub leaves it: owner-only database and key, one project 2770 in `group`, a 0660 file. */
async function goodDataDir(group: number): Promise<{ data: string; project: string }> {
  const data = join(await mkdtemp(join(tmpdir(), "cf-check-")), "data")
  HubStore.open(await prepareDataDir(data)).close()
  await loadOrCreateTicketKey(data)
  const project = join(data, "projects", "u1", "a".repeat(32))
  await mkdir(project, { recursive: true, mode: 0o700 })
  await chmod(join(data, "projects"), 0o700)
  await chmod(join(data, "projects", "u1"), 0o700)
  const { chown } = await import("node:fs/promises")
  await chown(project, process.getuid?.() ?? 0, group)
  await chmod(project, 0o2770)
  await mkdir(join(project, "board"), { mode: 0o2770 })
  await chmod(join(project, "board"), 0o2770)
  await writeFile(join(project, "board", "x.json"), "{}", { mode: 0o660 })
  await chmod(join(project, "board", "x.json"), 0o660)
  return { data, project }
}

describe("hub check-data", () => {
  test.runIf(!POSIX)("on Windows says the checks do not apply", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-check-"))
    const out = io()
    expect(await runCli(["hub", "check-data", "--data", data, "--workspace-group", "1000"], "/", out)).toBe(0)
    expect(out.lines.join("\n")).toMatch(/not checked on Windows/)
  })

  test.runIf(POSIX)("a data directory as the hub leaves it passes", async () => {
    const group = process.getgid?.() as number
    const { data } = await goodDataDir(group)
    const out = io()
    expect(await runCli(["hub", "check-data", "--data", data, "--workspace-group", String(group)], "/", out)).toBe(0)
    expect(out.lines.at(-1)).toMatch(/no problems/)
  })

  test.runIf(POSIX)("finds world access, a missing group right, a wrong project mode and a link out of the project", async () => {
    const group = process.getgid?.() as number
    const { data, project } = await goodDataDir(group)
    await chmod(join(project, "board", "x.json"), 0o644)
    await chmod(project, 0o750)
    await symlink("/etc/passwd", join(project, "out\u001b[31m"))
    await symlink("board/x.json", join(project, "inside"))
    const out = io()
    expect(await runCli(["hub", "check-data", "--data", data, "--workspace-group", String(group)], "/", out)).toBe(1)
    const text = out.lines.join("\n")
    expect(text).toMatch(/x\.json: .*others/)
    expect(text).toMatch(/x\.json: .*group/)
    expect(text).toMatch(/aaaa+: .*2770/)
    expect(text).toMatch(/points outside its project/)
    expect(text).not.toMatch(/inside: /)
    expect(text).not.toContain("\u001b")
  })

  test.runIf(POSIX)("--fix repairs what the hub's user owns, leaves links for a person, and refuses while the hub runs", async () => {
    const group = process.getgid?.() as number
    const { data, project } = await goodDataDir(group)
    await chmod(join(project, "board", "x.json"), 0o644)
    await chmod(join(data, "ticket-key.pem"), 0o644)
    await symlink("/etc/passwd", join(project, "out"))
    await writeFile(join(data, STATUS_FILE), JSON.stringify({ updated: Date.now(), pid: 1, running: 0, runner: "container" }))
    const running = io()
    expect(await runCli(["hub", "check-data", "--data", data, "--workspace-group", String(group), "--fix"], "/", running)).toBe(1)
    expect(running.errors.join("\n")).toMatch(/the hub is running/)
    await writeFile(join(data, STATUS_FILE), JSON.stringify({ updated: 0, pid: 1, running: 0, runner: "container" }))
    const fixed = io()
    expect(await runCli(["hub", "check-data", "--data", data, "--workspace-group", String(group), "--fix"], "/", fixed)).toBe(1)
    expect(fixed.lines.join("\n")).toMatch(/fixed/)
    const again = io()
    expect(await runCli(["hub", "check-data", "--data", data, "--workspace-group", String(group)], "/", again)).toBe(1)
    expect(again.lines.filter((line) => line.includes(": ")).map((line) => line.split(": ")[0])).toEqual([`projects/u1/${"a".repeat(32)}/out`])
  })

  test("needs the workspace group, from the option or the hub's status file", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-check-"))
    const out = io()
    expect(await runCli(["hub", "check-data", "--data", data], "/", out)).toBe(POSIX ? 1 : 0)
    if (POSIX) expect(out.errors.join("\n")).toMatch(/--workspace-group/)
  })
})
