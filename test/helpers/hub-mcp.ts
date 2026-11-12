// An agent for hub tests: the SDK's MCP client over Streamable HTTP, through a fetch on node:http so that Host can be
// the public origin's host (fetch itself may not set Host).
import { request } from "node:http"
import { Readable } from "node:stream"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { HubServer } from "../../src/hub/server.js"
import { ORIGIN } from "./hub-client.js"

export function hostFetch(base: string, host: string): (url: string | URL, init?: RequestInit) => Promise<Response> {
  const target = new URL(base)
  return (url, init) =>
    new Promise((done, fail) => {
      const path = new URL(url).pathname + new URL(url).search
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((value, name) => (headers[name] = value))
      headers.host = host
      const req = request({ host: target.hostname, port: target.port, method: init?.method ?? "GET", path, headers, signal: init?.signal ?? undefined }, (res) => {
        const answer = new Headers()
        for (const [name, value] of Object.entries(res.headers)) for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) answer.append(name, one)
        const status = res.statusCode ?? 0
        if (status === 204 || status === 304) {
          res.resume()
          return done(new Response(null, { status, headers: answer }))
        }
        done(new Response(Readable.toWeb(res) as ReadableStream, { status, headers: answer }))
      })
      req.on("error", fail)
      req.end(typeof init?.body === "string" ? init.body : undefined)
    })
}

export async function connectAgent(server: HubServer, token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    fetch: hostFetch(server.url, new URL(ORIGIN).host),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  })
  const client = new Client({ name: "test-agent", version: "0" })
  await client.connect(transport)
  return client
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}
