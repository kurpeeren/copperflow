// The real `copperflow mcp` over its pipe: one engine serves the whole session (a call that builds does not start
// the builder again), and the process ends by itself when the agent's program closes the pipe.
import { expect, test } from "vitest"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI = resolve("dist/cli.js")
const CIRCUIT = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" pcbX={4} pcbY={0} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" />
  </board>
)
`
const EXIT_WAIT_MS = 10_000

test.skipIf(!existsSync(CLI))("a session builds with one engine and ends when the pipe closes", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-session-"))
  await writeFile(join(root, "main.circuit.tsx"), CIRCUIT)
  const child = spawn(process.execPath, [CLI, "mcp", "--root", root], { stdio: ["pipe", "pipe", "ignore"] })
  try {
    const waiting = new Map<number, (message: { result?: { content: Array<{ text: string }> } }) => void>()
    let buffer = ""
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8")
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (line === "") continue
        const message = JSON.parse(line) as { id?: number; result?: { content: Array<{ text: string }> } }
        if (message.id !== undefined) waiting.get(message.id)?.(message)
      }
    })
    let next = 1
    const send = (method: string, params: unknown) =>
      new Promise<{ result?: { content: Array<{ text: string }> } }>((done) => {
        const id = next++
        waiting.set(id, done)
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      })
    await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
    const check = async () => {
      const started = performance.now()
      const answer = await send("tools/call", { name: "check_circuit", arguments: { file: "main.circuit.tsx" } })
      expect(answer.result?.content[0]?.text).toMatch(/^main\.circuit\.tsx: 0 errors/)
      return performance.now() - started
    }
    // The first call starts the engine; with one engine the later ones only build. The fastest of three later calls
    // against the first keeps a busy machine from deciding.
    const first = await check()
    const later = Math.min(await check(), await check(), await check())
    expect(later).toBeLessThan(first * 0.6)

    const ended = new Promise<number | null>((done) => child.once("exit", (code) => done(code)))
    child.stdin.end()
    const code = await Promise.race([ended, new Promise<string>((done) => setTimeout(() => done("still running"), EXIT_WAIT_MS))])
    expect(code).toBe(0)
  } finally {
    child.kill()
  }
})
