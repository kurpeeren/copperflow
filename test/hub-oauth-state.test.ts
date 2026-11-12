import { describe, expect, test } from "vitest"
import { OAuthState, PROTECTED_PER_USER } from "../src/hub/oauth-state.js"

const request = (clientId: string, userId?: string) => ({ clientId, redirectUri: "https://a.example/cb", challenge: "c".repeat(43), ...(userId ? { userId } : {}) })

describe("which pending authorisations protect a client from eviction", () => {
  test("10 000 unauthenticated authorise requests for distinct clients protect none of them", () => {
    const state = new OAuthState()
    for (let i = 0; i < 10_000; i += 1) expect(state.addRequest(request(`client-${i}`), 0, `address:${i}`)).toBeDefined()
    expect(state.pendingClients(1).size).toBe(0)
  })

  test("a request bound to a signed-in user protects its client, at most 5 per user; a live code protects its client", () => {
    const state = new OAuthState()
    for (let i = 0; i < 8; i += 1) state.addRequest(request(`a-${i}`, "u1"), i, `user:u1-${i}`)
    state.addRequest(request("b-0", "u2"), 0, "user:u2")
    state.addCode({ clientId: "coded", redirectUri: "https://a.example/cb", challenge: "c", userId: "u3", epoch: 0 }, 0)
    const protectedIds = state.pendingClients(1)
    expect([...protectedIds].filter((id) => id.startsWith("a-")).length).toBe(PROTECTED_PER_USER)
    expect(protectedIds.has("b-0")).toBe(true)
    expect(protectedIds.has("coded")).toBe(true)
    expect(state.pendingClients(11 * 60_000).size).toBe(0)
  })

  test("an owner holds at most 5 requests and only its own are dropped; a full table refuses rather than evicts", () => {
    const state = new OAuthState()
    const victim = state.addRequest(request("v"), 0, "address:victim") as string
    const flood = Array.from({ length: 7 }, (_, i) => state.addRequest(request(`f-${i}`), 0, "address:flood") as string)
    expect(state.request(victim, 1)).toBeDefined()
    expect(flood.filter((secret) => state.request(secret, 1) !== undefined)).toHaveLength(5)
    const full = new OAuthState()
    for (let i = 0; i < 10_000; i += 1) full.addRequest(request(`c-${i}`), 0, `address:${i}`)
    expect(full.addRequest(request("late"), 1, "address:late")).toBeUndefined()
    expect(full.addRequest(request("later"), 11 * 60_000, "address:late")).toBeDefined()
  })
})
