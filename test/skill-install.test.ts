import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, test } from "vitest"
import { installSkill } from "../src/skill-install.js"

const exists = (path: string) => stat(path).then(() => true, () => false)

describe("copperflow skill", () => {
  let project: string
  let home: string
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "cf-skill-"))
    home = await mkdtemp(join(tmpdir(), "cf-home-"))
  })

  test("copies both skills, with the references, into the project's .claude/skills", async () => {
    const said = await installSkill({ cwd: project, home })
    const skills = join(project, ".claude", "skills")
    expect(await readFile(join(skills, "copperflow", "SKILL.md"), "utf8")).toMatch(/^---\nname: copperflow\n/)
    expect(await readFile(join(skills, "copperflow-plan", "SKILL.md"), "utf8")).toMatch(/^---\nname: copperflow-plan\n/)
    expect(await exists(join(skills, "copperflow", "references", "copper.md"))).toBe(true)
    // The planning skill points at this file, beside it once both are installed.
    expect(await exists(join(skills, "copperflow-plan", "..", "copperflow", "references", "planning.md"))).toBe(true)
    expect(said).toMatch(/^Installed the copperflow skills \(copperflow, copperflow-plan; 10 files\) in .*[\\/]\.claude[\\/]skills\. Start a new agent session to load them\.$/)
    expect(await exists(join(home, ".claude"))).toBe(false)
  })

  test("a second run says updated and puts the package's text back", async () => {
    await installSkill({ cwd: project, home })
    const file = join(project, ".claude", "skills", "copperflow", "SKILL.md")
    await writeFile(file, "changed")
    const said = await installSkill({ cwd: project, home })
    expect(said).toMatch(/^Updated the copperflow skills \(/)
    expect(await readFile(file, "utf8")).toMatch(/^---\nname: copperflow\n/)
  })

  test("another skill the person keeps in the same folder is left alone", async () => {
    const own = join(project, ".claude", "skills", "mine")
    await mkdir(own, { recursive: true })
    await writeFile(join(own, "SKILL.md"), "mine")
    await installSkill({ cwd: project, home })
    expect(await readFile(join(own, "SKILL.md"), "utf8")).toBe("mine")
  })

  test("with global it goes under the home folder and the project is left alone", async () => {
    const said = await installSkill({ cwd: project, home, global: true })
    expect(await exists(join(home, ".claude", "skills", "copperflow", "SKILL.md"))).toBe(true)
    expect(await exists(join(home, ".claude", "skills", "copperflow-plan", "SKILL.md"))).toBe(true)
    expect(await exists(join(project, ".claude"))).toBe(false)
    expect(said).toContain(join(home, ".claude", "skills"))
  })

  test("a skill folder that is a link is refused and nothing is written through it", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "cf-else-"))
    await mkdir(join(project, ".claude", "skills"), { recursive: true })
    await symlink(elsewhere, join(project, ".claude", "skills", "copperflow-plan"), "junction")
    await expect(installSkill({ cwd: project, home })).rejects.toThrow(/is a link/)
    expect(await exists(join(elsewhere, "SKILL.md"))).toBe(false)
    // Refused before anything is copied: the other skill is not half installed.
    expect(await exists(join(project, ".claude", "skills", "copperflow"))).toBe(false)
  })
})
