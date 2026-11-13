import { afterEach, expect, test } from "vitest"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { HubServer } from "../src/hub/server.js"
import { newUser, startTestHub } from "./helpers/hub-client.js"
import { call, connectAgent } from "./helpers/hub-mcp.js"

let server: HubServer | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined)
  await server?.close()
  server = undefined
})

test("list_projects does not read a parts directory, so a planted link to a host folder tells nothing", async () => {
  server = await startTestHub()
  const ada = await newUser(server, "ada@example.com")
  await ada.submit("/projects", "/projects", { name: "Amp" })
  const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
  const id = server.hub.store.projects(userId)[0]?.id as string
  const dir = server.hub.files.projectDir(userId, id)
  // A host folder with seven entries, and a workspace-planted link to it named `parts`.
  const host = join(dir, "..", "..", "host-secret")
  await mkdir(host, { recursive: true })
  for (let i = 0; i < 7; i += 1) await writeFile(join(host, `entry-${i}`), "x")
  await symlink(host, join(dir, "parts"), "junction")
  await writeFile(join(dir, "main.circuit.tsx"), "export default () => null")
  const made = await ada.submit("/account", "/account/tokens", { name: "agent", password: "a good password" })
  const token = /cfp_[A-Za-z0-9_-]{43}/.exec(made.text)?.[0] as string
  const client = await connectAgent(server, token)
  clients.push(client)
  const answer = await call(client, "list_projects")
  expect(answer.text).toBe(`Your projects (1 of 20):\n- Amp (id ${id}, 1 circuit)`)
  expect(answer.text).not.toMatch(/\b7\b/)
  expect(answer.text).not.toContain("part")
})
