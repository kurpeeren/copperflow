import { afterEach, describe, expect, test } from "vitest"
import { request } from "node:http"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateTicketKeys, signTicket, TICKET_HEADER, TICKET_PUBLIC_KEY_ENV } from "../src/hosted/ticket.js"
import { parseWorkspaceArgs, startWorkspace, type Workspace } from "../src/hosted/workspace.js"
import { BOARD } from "./fixtures.js"

const KEYS = generateTicketKeys()
const ENV = { [TICKET_PUBLIC_KEY_ENV]: KEYS.publicKeyBase64 }
const ARGS = ["--root", "proj", "--id", "ws-1", "--public-origin", "https://cf.example.test", "--base-path", "/p/abc", "--studio-port", "0", "--mcp-port", "0"]
let running: Workspace | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

function get(origin: string, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const { port } = new URL(origin)
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk: string) => (body += chunk))
      res.on("end", () => done({ status: res.statusCode ?? 0, body }))
    })
    req.on("error", fail)
    req.end()
  })
}

describe("copperflow workspace", () => {
  test("parses its options and reads only the public key from the environment", () => {
    const { options, stopOnStdinEnd } = parseWorkspaceArgs([...ARGS, "--stop-on-stdin-end"], "/base", { ...ENV, COPPERFLOW_WORKSPACE_ID: "other", COPPERFLOW_PUBLIC_ORIGIN: "https://evil.test" })
    expect(options.id).toBe("ws-1")
    expect(options.publicOrigin).toBe("https://cf.example.test")
    expect(options.basePath).toBe("/p/abc")
    expect(options.bind).toBe("127.0.0.1")
    expect(options.studioPort).toBe(0)
    expect(stopOnStdinEnd).toBe(true)
    // The id is never taken from the environment.
    const withoutId = ARGS.filter((_, i) => i !== 2 && i !== 3)
    expect(() => parseWorkspaceArgs(withoutId, "/base", { ...ENV, COPPERFLOW_WORKSPACE_ID: "ws-1" })).toThrow(/Missing --id/)
  })

  test("refuses a missing key, a private key, a bad id, base path, port or option", () => {
    expect(() => parseWorkspaceArgs(ARGS, "/", {})).toThrow(/COPPERFLOW_TICKET_PUBLIC_KEY is not set/)
    const pem = KEYS.privateKey.export({ format: "pem", type: "pkcs8" }).toString()
    expect(() => parseWorkspaceArgs(ARGS, "/", { [TICKET_PUBLIC_KEY_ENV]: pem })).toThrow(/must be an Ed25519 key/)
    const swap = (name: string, value: string) => ARGS.map((arg, i) => (ARGS[i - 1] === name ? value : arg))
    expect(() => parseWorkspaceArgs(swap("--id", "../x"), "/", ENV)).toThrow(/--id must be/)
    expect(() => parseWorkspaceArgs(swap("--base-path", "/q/abc"), "/", ENV)).toThrow(/must start with \/p\//)
    expect(() => parseWorkspaceArgs(swap("--base-path", "/p/../x"), "/", ENV)).toThrow(/Bad base path/)
    expect(() => parseWorkspaceArgs(swap("--mcp-port", "70000"), "/", ENV)).toThrow(/--mcp-port must be a port/)
    expect(() => parseWorkspaceArgs([...ARGS, "--token", "x"], "/", ENV)).toThrow(/Unknown workspace option "--token"/)
    expect(() => parseWorkspaceArgs([...ARGS, "--id", "ws-2"], "/", ENV)).toThrow(/--id is given twice/)
  })

  test("serves the hosted Studio and MCP server for one folder, trusting only tickets", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-ws-"))
    await writeFile(join(root, "main.circuit.tsx"), BOARD)
    const { options } = parseWorkspaceArgs(ARGS.map((arg) => (arg === "proj" ? root : arg)), "/", ENV)
    running = await startWorkspace(options, { studio: { routeWorker: null, placeWorker: null, builder: { build: async () => Promise.reject(new Error("no builds here")) } } })
    expect(running.studio).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(running.mcp).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const now = Math.floor(Date.now() / 1000)
    const ticket = signTicket({ w: "ws-1", u: "user-1", iat: now, exp: now + 60 }, KEYS.privateKey)
    const listed = await get(running.studio, "/p/abc/api/circuits", { host: "cf.example.test", [TICKET_HEADER]: ticket })
    expect(listed.status).toBe(200)
    expect(JSON.parse(listed.body).data).toEqual(["main.circuit.tsx"])
    expect((await get(running.studio, "/p/abc/api/circuits", { host: "cf.example.test" })).status).toBe(403)
    expect((await get(running.mcp, "/mcp", { host: "cf.example.test", accept: "text/event-stream" })).status).toBe(403)
  })
})
