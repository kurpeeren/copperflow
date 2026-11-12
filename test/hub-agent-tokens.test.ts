import { afterEach, describe, expect, test } from "vitest"
import { hashSecret } from "../src/hub/secrets.js"
import type { HubServer } from "../src/hub/server.js"
import { formToken, newUser, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const TOKEN = /cfp_[A-Za-z0-9_-]{43}/

describe("personal access tokens", () => {
  test("a token is shown once, stored hashed, listed by name and revoked", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const made = await ada.submit("/account", "/account/tokens", { name: "My <agent>" })
    expect(made.status).toBe(200)
    const token = TOKEN.exec(made.text)?.[0] as string
    expect(token).toBeDefined()
    expect(made.text).toContain("My &lt;agent&gt;")
    const page = await ada.get("/account")
    expect(page.text).toContain("My &lt;agent&gt;")
    expect(page.text).not.toContain(token)
    expect(page.text).toContain("https://cf.example.test/mcp")
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const [listed] = server.hub.store.tokens.personalTokens(userId)
    expect(server.hub.store.tokens.credential(hashSecret(token), Date.now())).toEqual({ userId, credential: `pat:${listed?.id}`, kind: "pat", expires: null })
    const revoked = await ada.post(`/account/tokens/${listed?.id}/revoke`, { form: formToken(page.text) })
    expect(revoked.status).toBe(303)
    expect(server.hub.store.tokens.credential(hashSecret(token), Date.now())).toBeUndefined()
    const events = server.hub.store.auditLog(20).map((e) => e.event)
    expect(events).toContain("token-created")
    expect(events).toContain("token-revoked")
    expect(JSON.stringify(server.hub.store.auditLog(50))).not.toContain(token)
  })

  test("at most 10 per user, a name is required, and the form needs its token", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    for (let i = 0; i < 10; i += 1) expect((await ada.submit("/account", "/account/tokens", { name: `t${i}` })).status).toBe(200)
    const eleventh = await ada.submit("/account", "/account/tokens", { name: "t10" })
    expect(eleventh.status).toBe(403)
    expect(eleventh.text).not.toMatch(TOKEN)
    expect((await ada.submit("/account", "/account/tokens", { name: "  " })).status).toBe(400)
    expect((await ada.post("/account/tokens", { name: "x" })).status).toBe(403)
  })

  test("another user's token or client is not found", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/account", "/account/tokens", { name: "mine" })
    const adaId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const id = server.hub.store.tokens.personalTokens(adaId)[0]?.id as string
    const bob = await newUser(server, "bob@example.com")
    const form = formToken((await bob.get("/account")).text)
    expect((await bob.post(`/account/tokens/${id}/revoke`, { form })).status).toBe(404)
    expect((await bob.post(`/account/clients/${id}/revoke`, { form })).status).toBe(404)
    expect(server.hub.store.tokens.personalTokens(adaId)).toHaveLength(1)
  })
})
