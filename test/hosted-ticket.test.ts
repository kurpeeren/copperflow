import { describe, expect, test } from "vitest"
import { signTicket, ticketKeyFromEnv, TICKET_KEY_ENV, verifyTicket } from "../src/hosted/ticket.js"
import { normaliseBasePath } from "../src/hosted/gate.js"

const KEY = Buffer.from("s".repeat(32))
const NOW = 1_800_000_000

describe("workspace tickets", () => {
  test("a signed ticket verifies and gives its payload back", () => {
    const text = signTicket({ w: "ws", u: "u1", exp: NOW + 30 }, KEY)
    expect(text).toMatch(/^[\w-]+\.[\w-]{43}$/)
    expect(verifyTicket(text, KEY, NOW, "ws")).toEqual({ ok: true, payload: { w: "ws", u: "u1", exp: NOW + 30 } })
  })

  test("refuses expired, foreign, other-key, malformed and missing tickets", () => {
    const text = signTicket({ w: "ws", u: "u1", exp: NOW }, KEY)
    expect(verifyTicket(text, KEY, NOW, "ws")).toEqual({ ok: false, reason: "Expired workspace ticket" })
    const fresh = signTicket({ w: "ws", u: "u1", exp: NOW + 1 }, KEY)
    expect(verifyTicket(fresh, KEY, NOW, "other")).toEqual({ ok: false, reason: "The ticket is for another workspace" })
    expect(verifyTicket(fresh, Buffer.from("t".repeat(32)), NOW, "ws")).toEqual({ ok: false, reason: "Invalid workspace ticket" })
    expect(verifyTicket("a.b.c", KEY, NOW)).toEqual({ ok: false, reason: "Malformed workspace ticket" })
    expect(verifyTicket(undefined, KEY, NOW)).toEqual({ ok: false, reason: "Missing workspace ticket" })
    const notJson = Buffer.from("nope").toString("base64url")
    const signed = signTicket({ w: "x", u: "y", exp: 1 }, KEY).split(".")[1]
    expect(verifyTicket(`${notJson}.${signed}`, KEY, NOW).ok).toBe(false)
  })

  test("the key comes from the environment, 32 bytes at least, and is never repeated in the error", () => {
    expect(() => ticketKeyFromEnv({})).toThrow(`${TICKET_KEY_ENV} is not set`)
    try {
      ticketKeyFromEnv({ [TICKET_KEY_ENV]: "short-secret-value" })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toBe(`${TICKET_KEY_ENV} must be at least 32 bytes`)
      expect((error as Error).message).not.toContain("short-secret-value")
    }
    expect(ticketKeyFromEnv({ [TICKET_KEY_ENV]: "x".repeat(32) }).length).toBe(32)
    expect(() => signTicket({ w: "a", u: "b", exp: 1 }, Buffer.from("short"))).toThrow("at least 32 bytes")
  })

  test("base paths take one form and refuse dot segments", () => {
    expect(normaliseBasePath("/p/demo/")).toBe("/p/demo")
    expect(normaliseBasePath("")).toBe("")
    expect(() => normaliseBasePath("/p/../x")).toThrow("Bad base path")
    expect(() => normaliseBasePath("p")).toThrow("Bad base path")
  })
})
