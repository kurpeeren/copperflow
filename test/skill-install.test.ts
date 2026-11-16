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

  test("copies the skill and its references into the project's .claude/skills/copperflow", async () => {
    const said = await installSkill({ cwd: project, home })
    const target = join(project, ".claude", "skills", "copperflow")
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toMatch(/^---\nname: copperflow/)
    expect(await exists(join(target, "references", "copper.md"))).toBe(true)
    expect(said).toMatch(/^Installed the copperflow skill in .*[\\/]\.claude[\\/]skills[\\/]copperflow \(7 files\)\. Start a new agent session to load it\.$/)
    expect(await exists(join(home, ".claude"))).toBe(false)
  })

  test("a second run says updated and puts the package's text back", async () => {
    await installSkill({ cwd: project, home })
    const file = join(project, ".claude", "skills", "copperflow", "SKILL.md")
    await writeFile(file, "changed")
    const said = await installSkill({ cwd: project, home })
    expect(said).toMatch(/^Updated the copperflow skill in /)
    expect(await readFile(file, "utf8")).toMatch(/^---\nname: copperflow/)
  })

  test("with global it goes under the home folder and the project is left alone", async () => {
    const said = await installSkill({ cwd: project, home, global: true })
    expect(await exists(join(home, ".claude", "skills", "copperflow", "SKILL.md"))).toBe(true)
    expect(await exists(join(project, ".claude"))).toBe(false)
    expect(said).toContain(join(home, ".claude", "skills", "copperflow"))
  })

  test("a skill folder that is a link is refused and nothing is written through it", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "cf-else-"))
    await mkdir(join(project, ".claude", "skills"), { recursive: true })
    await symlink(elsewhere, join(project, ".claude", "skills", "copperflow"), "junction")
    await expect(installSkill({ cwd: project, home })).rejects.toThrow(/is a link/)
    expect(await exists(join(elsewhere, "SKILL.md"))).toBe(false)
  })
})
