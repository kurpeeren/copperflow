import { afterEach, describe, expect, test } from "vitest"
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { Writable } from "node:stream"
import { streamMultipart } from "../src/hub/multipart-stream.js"
import { join } from "node:path"
import { deflateRawSync } from "node:zlib"
import { crc32 } from "../src/engine/fab/zip.js"
import type { HubServer } from "../src/hub/server.js"
import { readZipArchive, ZipWriter } from "../src/hub/zip.js"
import { Browser, formToken, newUser, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

interface RawEntry {
  name: string
  data?: Buffer
  /** Unix mode in the external attributes (made by Unix). */
  mode?: number
  deflate?: boolean
  /** Overrides the declared unpacked size. */
  declaredSize?: number
}

/** A zip built by hand, so the tests can write what a hostile archive holds. */
function rawZip(entries: RawEntry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const data = entry.data ?? Buffer.from("x")
    const body = entry.deflate ? deflateRawSync(data) : data
    const name = Buffer.from(entry.name, "utf8")
    const fill = (header: Buffer, at: number) => {
      header.writeUInt16LE(20, at)
      header.writeUInt16LE(0x0800, at + 2)
      header.writeUInt16LE(entry.deflate ? 8 : 0, at + 4)
      header.writeUInt32LE(crc32(data), at + 10)
      header.writeUInt32LE(body.length, at + 14)
      header.writeUInt32LE(entry.declaredSize ?? data.length, at + 18)
      header.writeUInt16LE(name.length, at + 22)
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    fill(local, 4)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE((3 << 8) | 20, 4)
    fill(record, 6)
    record.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    record.writeUInt32LE(offset, 42)
    parts.push(local, name, body)
    central.push(record, name)
    offset += 30 + name.length + body.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

const idOf = (s: HubServer, email: string) => s.hub.store.userByEmail(email)?.id as string

describe("hub projects", () => {
  test("creates, renames and deletes a project with its name typed to confirm", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    expect((await ada.submit("/projects", "/projects", { name: "CAN module" })).status).toBe(303)
    const [project] = server.hub.store.projects(idOf(server, "ada@example.com"))
    expect(project?.name).toBe("CAN module")
    expect(project?.id).toMatch(/^[0-9a-f]{32}$/)
    const dir = server.hub.files.projectDir(idOf(server, "ada@example.com"), project?.id as string)
    expect(dir.endsWith(join("projects", idOf(server, "ada@example.com"), project?.id as string))).toBe(true)
    expect((await ada.submit("/projects", "/projects", { name: "CAN module" })).status).toBe(409)
    expect((await ada.submit("/projects", `/projects/${project?.id}/rename`, { name: "CAN board" })).status).toBe(303)
    expect((await ada.submit("/projects", `/projects/${project?.id}/delete`, { confirm: "CAN module" })).text).toContain("Type the project&#39;s name exactly to delete it.")
    expect((await ada.submit("/projects", `/projects/${project?.id}/delete`, { confirm: "CAN board" })).status).toBe(303)
    expect(server.hub.store.projects(idOf(server, "ada@example.com"))).toEqual([])
  })

  test("every project route and the proxy refuse without a session, and answer another user's project with 404", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/projects", "/projects", { name: "Amp" })
    const id = server.hub.store.projects(idOf(server, "ada@example.com"))[0]?.id as string
    const nobody = new Browser(server.url)
    for (const path of ["/projects", `/projects/${id}/download`, `/p/${id}/`, "/account"]) expect((await nobody.get(path)).headers.location).toBe("/signin")
    expect((await nobody.get(`/p/${id}/api/circuits`)).status).toBe(404)
    const adaId = idOf(server, "ada@example.com")
    const snapshot = () => ({ projects: server?.hub.store.projects(adaId), sessions: server?.hub.store.sessionCount(adaId), hash: server?.hub.store.userById(adaId)?.passwordHash })
    const before = snapshot()
    for (const path of ["/projects", `/projects/${id}/rename`, `/projects/${id}/delete`, "/account/password", "/account/delete", "/signout"]) {
      expect((await nobody.post(path, { name: "x", form: "x", confirm: "Amp", password: "another password" })).status).toBe(403)
    }
    expect(snapshot()).toEqual(before)
    const bob = await newUser(server, "bob@example.com")
    const bobToken = /name="form" value="([^"]+)"/.exec((await bob.get("/projects")).text)?.[1] as string
    for (const path of [`/projects/${id}/download`, `/p/${id}/`, `/p/${id}/api/circuits`]) expect((await bob.get(path)).status).toBe(404)
    for (const path of [`/projects/${id}/rename`, `/projects/${id}/delete`]) expect((await bob.post(path, { name: "Mine", confirm: "Amp", form: bobToken })).status).toBe(404)
    expect((await bob.post(`/p/${id}/api/edit`, { form: bobToken })).status).toBe(404)
    // An id that was never made reads the same.
    expect((await bob.get(`/projects/${"0".repeat(32)}/download`)).status).toBe(404)
    expect(server.hub.store.projects(idOf(server, "ada@example.com"))[0]?.name).toBe("Amp")
  })

  test("a project or user marked deleted is answered 404 everywhere and its workspace is not started", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/projects", "/projects", { name: "Amp" })
    const adaId = idOf(server, "ada@example.com")
    const id = server.hub.store.projects(adaId)[0]?.id as string
    const token = formToken((await ada.get("/projects")).text)
    server.hub.store.markProjectDeleted(adaId, id)
    for (const path of [`/projects/${id}/download`, `/p/${id}/`, `/p/${id}/api/circuits`]) expect((await ada.get(path)).status).toBe(404)
    expect((await ada.post(`/projects/${id}/rename`, { form: token, name: "B" })).status).toBe(404)
    expect(server.hub.runner.state(id)).toBe("stopped")
    expect((await ada.get("/projects")).text).not.toContain(id)
    server.hub.store.markUserDeleted(adaId)
    expect((await ada.get("/projects")).headers.location).toBe("/signin")
    expect((await new Browser(server.url).signIn("ada@example.com")).status).toBe(401)
  })

  test("no page reflects a name unescaped", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/projects", "/projects", { name: "<script>alert(1)</script>" })
    const page = (await ada.get("/projects")).text
    expect(page).not.toContain("<script>")
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    const again = (await ada.submit("/projects", "/projects", { name: "<script>alert(1)</script>" })).text
    expect(again).not.toContain("<script>")
    const account = (await ada.get("/account")).text
    expect(account).not.toMatch(/<script/i)
    expect((await ada.get("/projects")).headers["content-security-policy"]).toContain("default-src 'none'")
  })

  test("quotas: 20 projects, and the disk space of the plan", async () => {
    server = await startTestHub({ maxProjects: 2, maxBytes: 1000 })
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/projects", "/projects", { name: "One" })
    await ada.submit("/projects", "/projects", { name: "Two" })
    const third = await ada.submit("/projects", "/projects", { name: "Three" })
    expect(third.status).toBe(403)
    expect(third.text).toContain("You have 2 projects, the most the plan allows.")
    const [first] = server.hub.store.projects(idOf(server, "ada@example.com"))
    await ada.submit("/projects", `/projects/${first?.id}/delete`, { confirm: first?.name as string })
    await writeFile(join(server.hub.files.projectDir(idOf(server, "ada@example.com"), server.hub.store.projects(idOf(server, "ada@example.com"))[0]?.id as string), "big.bin"), Buffer.alloc(1000))
    const full = await ada.submit("/projects", "/projects", { name: "Three" })
    expect(full.status).toBe(403)
    expect(full.text).toContain("Your projects use all the disk space the plan allows.")
    const upload = await ada.upload("Four", rawZip([{ name: "a.txt" }]))
    expect(upload.status).toBe(403)
  })

  test("a project downloads as a zip and uploads back into a new project", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/projects", "/projects", { name: "Amp" })
    const userId = idOf(server, "ada@example.com")
    const project = server.hub.store.projects(userId)[0]
    const dir = server.hub.files.projectDir(userId, project?.id as string)
    await mkdir(join(dir, "parts", "U1"), { recursive: true })
    await mkdir(join(dir, ".copperflow", "history"), { recursive: true })
    await writeFile(join(dir, "main.circuit.tsx"), "export default () => <board />\n")
    await writeFile(join(dir, "parts", "U1", "datasheet.pdf"), Buffer.from([0, 1, 2, 255, 254]))
    await writeFile(join(dir, ".copperflow", "history", "0001.json"), "{}")
    await writeFile(join(dir, "main.circuit.tsx.123.abcdef12.tmp"), "half written")
    const download = await ada.get(`/projects/${project?.id}/download`)
    expect(download.status).toBe(200)
    expect(download.headers["content-type"]).toBe("application/zip")
    expect(download.headers["content-disposition"]).toBe(`attachment; filename="copperflow-${project?.id}.zip"`)
    const entries = readZipArchive(download.body)
    expect(entries.map((e) => e.name).sort()).toEqual([".copperflow/history/0001.json", "main.circuit.tsx", "parts/U1/datasheet.pdf"])
    expect(entries.find((e) => e.name === "parts/U1/datasheet.pdf")?.data).toEqual(Buffer.from([0, 1, 2, 255, 254]))
    const uploaded = await ada.upload("Amp copy", download.body)
    expect(uploaded.status).toBe(303)
    const copy = server.hub.store.projects(userId).find((p) => p.name === "Amp copy")
    const copyDir = server.hub.files.projectDir(userId, copy?.id as string)
    expect(await readFile(join(copyDir, "main.circuit.tsx"), "utf8")).toBe("export default () => <board />\n")
    expect(await readFile(join(copyDir, "parts", "U1", "datasheet.pdf"))).toEqual(Buffer.from([0, 1, 2, 255, 254]))
  })

  test("upload refuses every bad entry kind and the size and ratio limits, writing nothing", async () => {
    server = await startTestHub({ maxBytes: 1024 * 1024 })
    const ada = await newUser(server, "ada@example.com")
    const cases: [string, Buffer, string][] = [
      ["absolute", rawZip([{ name: "/etc/passwd" }]), "an absolute path"],
      ["drive", rawZip([{ name: "C:/x.txt" }]), "an absolute path"],
      ["dotdot", rawZip([{ name: "a/../../x.txt" }]), "a .. segment"],
      ["backslash", rawZip([{ name: "a\\x.txt" }]), "a backslash"],
      ["link", rawZip([{ name: "link", mode: 0o120777, data: Buffer.from("/etc/passwd") }]), "a link or special file"],
      ["device", rawZip([{ name: "parts/CON.txt" }]), "a device name"],
      ["device bare", rawZip([{ name: "nul" }]), "a device name"],
      ["many", rawZip(Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.txt` }))), "more than 2000 entries"],
      ["big", rawZip([{ name: "big.bin", data: Buffer.alloc(1024 * 1024 + 1, 1), deflate: true }]), "unpacks to more than 1 MB"],
      ["ratio", rawZip([{ name: "zeros.bin", data: Buffer.alloc(200_000), deflate: true }]), "more than 100 times its size"],
      ["lying size", rawZip([{ name: "a.bin", data: Buffer.alloc(5000), deflate: true, declaredSize: 10 }]), "damaged"],
      ["twice", rawZip([{ name: "A.txt" }, { name: "a.txt" }]), "twice"],
      ["unicode twice", rawZip([{ name: "café.txt" }, { name: "café.txt" }]), "differ only in case or Unicode form"],
      ["not a zip", Buffer.from("hello"), "not a zip archive"],
    ]
    for (const [label, archive, reason] of cases) {
      const answer = await ada.upload(`up ${label}`, archive)
      expect(answer.status, label).toBe(400)
      expect(answer.text, label).toContain("The archive was not uploaded")
      expect(answer.text, label).toContain(reason)
    }
    expect(server.hub.store.projects(idOf(server, "ada@example.com"))).toEqual([])
    expect(await server.hub.files.usage(idOf(server, "ada@example.com"))).toBe(0)
    const ok = await ada.upload("fine", rawZip([{ name: "dir/a.txt", data: Buffer.from("hello") }]))
    expect(ok.status).toBe(303)
  })

  test("uploads stream to a file with the cap enforced while reading, and leave nothing behind", async () => {
    server = await startTestHub({ maxBytes: 100_000 })
    const ada = await newUser(server, "ada@example.com")
    // Refused while it arrives: the client sees 413, or the connection closed under it.
    const big = await ada.upload("big", Buffer.alloc(300_000, 7)).then((answer) => answer.status, (error: Error) => error.message)
    expect([413, "read ECONNRESET", "write ECONNRESET", "socket hang up"]).toContain(big)
    const bad = await ada.upload("bad", rawZip([{ name: "../x" }]))
    expect(bad.status).toBe(400)
    const ok = await ada.upload("ok", rawZip([{ name: "a.txt", data: Buffer.from("hi") }]))
    expect(ok.status).toBe(303)
    expect(await readdir(server.hub.files.uploads)).toEqual([])
    expect(server.hub.store.projects(idOf(server, "ada@example.com")).map((p) => p.name)).toEqual(["ok"])
  })

  test("at most 4 uploads run in the hub and 2 downloads per user", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/projects", "/projects", { name: "Amp" })
    const id = server.hub.store.projects(idOf(server, "ada@example.com"))[0]?.id as string
    server.hub.transfers.uploads = 4
    expect((await ada.upload("busy", rawZip([{ name: "a.txt" }]))).status).toBe(503)
    server.hub.transfers.uploads = 0
    server.hub.transfers.downloads.set(idOf(server, "ada@example.com"), 2)
    expect((await ada.get(`/projects/${id}/download`)).status).toBe(429)
    server.hub.transfers.downloads.clear()
    expect((await ada.get(`/projects/${id}/download`)).status).toBe(200)
    expect(server.hub.transfers.downloads.size).toBe(0)
  })

  test("the streaming form reader gives the same fields however the bytes are split", async () => {
    const boundary = "b0undary"
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="form"\r\n\r\ntok\r\n--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="p.zip"\r\n\r\nAB\r\nCD--${boundary}x\r\n--${boundary}--\r\n`,
    )
    for (const size of [1, 2, 3, 7, 50, body.length]) {
      const chunks = Array.from({ length: Math.ceil(body.length / size) }, (_, i) => body.subarray(i * size, (i + 1) * size))
      const written: Buffer[] = []
      const sink = new Writable({ write: (chunk: Buffer, _e, next) => (written.push(chunk), next()) })
      const form = await streamMultipart((async function* () { yield* chunks })(), boundary, 10_000, () => sink)
      expect(form.fields.get("form")).toBe("tok")
      expect(form.fileField).toBe("archive")
      expect(Buffer.concat(written).toString()).toBe(`AB\r\nCD--${boundary}x`)
    }
  })

  test("the zip writer and reader agree", async () => {
    const chunks: Buffer[] = []
    const zip = new ZipWriter(async (chunk) => void chunks.push(chunk))
    await zip.add("a/b.txt", Buffer.from("hello hello hello hello"), new Date(Date.UTC(2026, 0, 2, 3, 4, 6)))
    await zip.add("c.bin", Buffer.from([1, 2, 3]), new Date(Date.UTC(2026, 0, 2)))
    await zip.finish()
    expect(readZipArchive(Buffer.concat(chunks)).map((e) => [e.name, e.data.toString("hex")])).toEqual([
      ["a/b.txt", Buffer.from("hello hello hello hello").toString("hex")],
      ["c.bin", "010203"],
    ])
  })
})
