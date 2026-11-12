import { describe, expect, test } from "vitest"
import { OAuthState, PROTECTED_PER_USER } from "../src/hub/oauth-state.js"

const request = (clientId: string, userId?: string) => ({ clientId, redirectUri: "https://a.example/cb", challenge: "c".repeat(43), ...(userId ? { userId } : {}) })

describe("which pending authorisations protect a client from eviction", () => {
  test("10 000 unauthenticated authorise requests for distinct clients protect none of them", () => {
    const state = new OAuthState()
    for (let i = 0; i < 10_000; i += 1) state.addRequest(request(`client-${i}`), 0)
    expect(state.pendingClients(1).size).toBe(0)
  })

  test("a request bound to a signed-in user protects its client, at most 5 per user; a live code protects its client", () => {
    const state = new OAuthState()
    for (let i = 0; i < 8; i += 1) state.addRequest(request(`a-${i}`, "u1"), 0)
    state.addRequest(request("b-0", "u2"), 0)
    state.addCode({ clientId: "coded", redirectUri: "https://a.example/cb", challenge: "c", userId: "u3", epoch: 0 }, 0)
    const protectedIds = state.pendingClients(1)
    expect([...protectedIds].filter((id) => id.startsWith("a-")).length).toBe(PROTECTED_PER_USER)
    expect(protectedIds.has("b-0")).toBe(true)
    expect(protectedIds.has("coded")).toBe(true)
    expect(state.pendingClients(11 * 60_000).size).toBe(0)
  })
})
