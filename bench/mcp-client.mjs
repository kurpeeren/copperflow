// A minimal MCP client over stdio for measuring a project after a run: starts this checkout's server, calls tools.
import { spawn } from "node:child_process"

/** Starts `node <cli> mcp --root <root>` and returns { listTools, call, close }. */
export async function startServer(cliPath, root) {
  const child = spawn(process.execPath, [cliPath, "mcp", "--root", root], { stdio: ["pipe", "pipe", "pipe"] })
  let buffer = ""
  const waiting = new Map()
  child.stderr.on("data", () => {})
  child.stdout.on("data", (chunk) => {
    buffer += chunk
    let at
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at).trim()
      buffer = buffer.slice(at + 1)
      if (!line) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.id !== undefined && waiting.has(message.id)) {
        waiting.get(message.id)(message)
        waiting.delete(message.id)
      }
    }
  })
  let next = 1
  const request = (method, params, timeoutMs = 300_000) =>
    new Promise((resolve, reject) => {
      const id = next++
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      waiting.set(id, (message) => {
        clearTimeout(timer)
        resolve(message)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    })
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bench", version: "1" } })
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
  return {
    async listTools() {
      const answer = await request("tools/list", {})
      return (answer.result?.tools ?? []).map((tool) => tool.name)
    },
    /** Returns { text, isError }. */
    async call(name, args = {}) {
      const answer = await request("tools/call", { name, arguments: args })
      const text = (answer.result?.content ?? []).map((part) => part.text ?? "").join("\n") || JSON.stringify(answer.error ?? "")
      return { text, isError: Boolean(answer.result?.isError || answer.error) }
    },
    close() {
      child.kill()
    },
  }
}
