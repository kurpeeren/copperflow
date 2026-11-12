import { afterEach, describe, expect, test } from "vitest"
import type { HubServer } from "../src/hub/server.js"
import { MAX_ENTER_TOKENS, MAX_ENTER_TOKENS_PER_USER } from "../src/hub/project-origin.js"
import { newUser, startTestHub, type Browser } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function projectOf(hub: HubServer, browser: Browser, email: string): Promise<string> {
  await browser.submit("/projects", "/projects", { name: "Amp" })
  return hub.hub.store.projects(hub.hub.store.userByEmail(email)?.id as string)[0]?.id as string
}

describe("enter tokens are capped per user", () => {
  test("the limits are 4 per user and 10 000 in the hub", () => {
    expect(MAX_ENTER_TOKENS_PER_USER).toBe(4)
    expect(MAX_ENTER_TOKENS).toBe(10_000)
  })

  test("a fifth token replaces that user's oldest; the first is then refused", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const paths: string[] = []
    for (let i = 0; i < MAX_ENTER_TOKENS_PER_USER + 1; i++) {
      const location = new URL(String((await ada.get(`/p/${id}/`)).headers.location))
      paths.push(`${location.pathname}${location.search}`)
    }
    expect(server.hub.enterTokens.size).toBe(MAX_ENTER_TOKENS_PER_USER)
    expect((await ada.onProject(id, "GET", paths[0] as string)).status).toBe(404)
    expect((await ada.onProject(id, "GET", paths[4] as string)).status).toBe(303)
    // A token that was used is gone from the user's list too.
    expect(server.hub.enterTokens.size).toBe(MAX_ENTER_TOKENS_PER_USER - 1)
    expect(server.hub.enterByUser.get(server.hub.store.userByEmail("ada@example.com")?.id as string)?.length).toBe(MAX_ENTER_TOKENS_PER_USER - 1)
  })

  test("one user opening a project 10 001 times leaves another user able to enter", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const bob = await newUser(server, "bob@example.com")
    const adaProject = await projectOf(server, ada, "ada@example.com")
    const bobProject = await projectOf(server, bob, "bob@example.com")
    for (let i = 0; i < MAX_ENTER_TOKENS + 1; i++) expect((await ada.get(`/p/${adaProject}/`)).status).toBe(303)
    expect(server.hub.enterTokens.size).toBeLessThanOrEqual(MAX_ENTER_TOKENS_PER_USER)
    const { handover, entered } = await bob.openProject(bobProject)
    expect(handover.status).toBe(303)
    expect(entered?.status).toBe(303)
  }, 120_000)

  test("when the hub-wide table is full of live tokens, a new one is refused with 503 (never let through)", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    await ada.get(`/p/${id}/`)
    // Fill the rest of the table with other users' live tokens.
    const now = Date.now()
    for (let i = server.hub.enterTokens.size; i < MAX_ENTER_TOKENS; i++) {
      server.hub.enterTokens.set(`filler-${i}`, { userId: `other-${i % 3000}`, projectId: "p", expires: now + 60_000, epoch: 0, hubSession: "s" })
    }
    // Ada holds 1 token; the table is full, so another one is refused (fail closed) ...
    expect((await ada.get(`/p/${id}/`)).status).toBe(503)
  })
})
