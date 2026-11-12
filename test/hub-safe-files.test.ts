import { describe, expect, test } from "vitest"
import { PassThrough } from "node:stream"
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ProjectFiles, type ProjectFile } from "../src/hub/projects.js"
import { checkNoLinks, openListed, removeTree, usageOf, walkProject } from "../src/hub/safe-files.js"
import { readZip } from "./helpers/zip-read.js"

const USER = "a".repeat(32)
const PROJECT = "b".repeat(32)
const SECRET = "HOST-SECRET-CONTENT"

/** Makes a link; on Windows a file link may need a privilege the test run lacks, a directory junction does not. */
async function link(target: string, path: string, kind: "file" | "dir"): Promise<boolean> {
  try {
    await symlink(target, path, kind === "dir" ? "junction" : "file")
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return false
    throw error
  }
}

async function setup() {
  const data = await mkdtemp(join(tmpdir(), "cf-safe-"))
  const outside = join(data, "outside")
  await mkdir(outside)
  await writeFile(join(outside, "secret.txt"), SECRET)
  const files = new ProjectFiles(data)
  const dir = await files.create(USER, PROJECT)
  await writeFile(join(dir, "main.circuit.tsx"), "export default () => null\n")
  return { data, outside, files, dir }
}

async function downloadText(files: ProjectFiles): Promise<{ names: string[]; text: string; failed?: string }> {
  const out = new PassThrough()
  const chunks: Buffer[] = []
  out.on("data", (chunk: Buffer) => chunks.push(chunk))
  const failed = await files.download(USER, PROJECT, out).then(
    () => undefined,
    (error: Error) => error.message,
  )
  const bytes = Buffer.concat(chunks)
  return { names: failed ? [] : readZip(new Uint8Array(bytes)).map((entry) => entry.name), text: bytes.toString("latin1"), ...(failed ? { failed } : {}) }
}

describe("the hub never follows a link inside a project", () => {
  test("a linked file and a linked directory are skipped by listing, usage, download and deletion", async () => {
    const { outside, files, dir } = await setup()
    const fileLinked = await link(join(outside, "secret.txt"), join(dir, "leak.txt"), "file")
    expect(await link(outside, join(dir, "leakdir"), "dir")).toBe(true)
    const notes: string[] = []
    const listed = await walkProject(dir, (path) => notes.push(path))
    expect(listed.map((file) => file.name)).toEqual(["main.circuit.tsx"])
    expect(notes).toEqual(expect.arrayContaining(["leakdir", ...(fileLinked ? ["leak.txt"] : [])]))
    expect(await usageOf(dir)).toBe("export default () => null\n".length)
    const zip = await downloadText(files)
    expect(zip.names).toEqual(["main.circuit.tsx"])
    await files.remove(USER, PROJECT)
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe(SECRET)
    expect(await readdir(outside)).toEqual(["secret.txt"])
  })

  test("a file replaced by a link after the listing is not read: the download ends instead", async () => {
    const { outside, dir } = await setup()
    await writeFile(join(dir, "swap.txt"), "harmless")
    const swapped = class extends ProjectFiles {
      override async list(folder: string): Promise<ProjectFile[]> {
        const found = await super.list(folder)
        // The container swaps the file for a link between the hub's two steps.
        await rm(join(dir, "swap.txt"))
        if (!(await link(join(outside, "secret.txt"), join(dir, "swap.txt"), "file"))) await writeFile(join(dir, "swap.txt"), SECRET)
        return found
      }
    }
    const files = new swapped(join(dir, "..", "..", ".."))
    const notes: string[] = []
    files.note = (path) => notes.push(path)
    const zip = await downloadText(files)
    expect(zip.failed).toBeDefined()
    expect(zip.text).not.toContain(SECRET)
    expect(notes).toEqual(["swap.txt"])
  })

  test("opening checks the handle is the listed file", async () => {
    const { dir } = await setup()
    const [file] = await walkProject(dir)
    const handle = await openListed(dir, file as ProjectFile)
    await handle.close()
    await expect(openListed(dir, { ...(file as ProjectFile), ino: (file as ProjectFile).ino + 1 })).rejects.toThrow(/changed/)
  })

  test("removal unlinks links without touching their targets, and unpack targets refuse a linked folder", async () => {
    const { outside, dir } = await setup()
    expect(await link(outside, join(dir, "parts"), "dir")).toBe(true)
    await expect(checkNoLinks(dir, join(dir, "parts", "x.yaml"))).rejects.toThrow(/symbolic link/)
    await checkNoLinks(dir, join(dir, "boards", "x.tsx"))
    await removeTree(dir)
    expect(await readdir(outside)).toEqual(["secret.txt"])
  })
})
