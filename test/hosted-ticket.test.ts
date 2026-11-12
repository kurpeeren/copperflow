import { describe, expect, test } from "vitest"
import { sign } from "node:crypto"
import { generateTicketKeys, signTicket, ticketPublicKey, ticketPublicKeyFromEnv, TICKET_PUBLIC_KEY_ENV, verifyTicket } from "../src/hosted/ticket.js"
import { normaliseBasePath } from "../src/hosted/gate.js"

const keys = generateTicketKeys()
const NOW = 1_800_000_000
type Fields = { w: string; u: string; iat: number; exp: number }
const payload = (over: Partial<Fields> = {}): Fields => ({ w: "ws", u: "u1", iat: NOW, exp: NOW + 60, ...over })

describe("workspace tickets (Ed25519)", () => {
  test("a ticket signed with the private key verifies with the public key", () => {
    const text = signTicket(payload(), keys.privateKey)
    expect(text).toMatch(/^[\w-]+\.[\w-]{86}$/)
    expect(verifyTicket(text, keys.publicKey, NOW, "ws")).toEqual({ ok: true, payload: payload() })
  })

  test("the public key cannot sign, and a ticket from another key pair is invalid", () => {
    expect(() => signTicket(payload(), keys.publicKey)).toThrow("Ed25519 private key")
    const other = generateTicketKeys()
    expect(verifyTicket(signTicket(payload(), other.privateKey), keys.publicKey, NOW, "ws")).toEqual({ ok: false, reason: "Invalid workspace ticket" })
  })

  test("refuses expired, foreign, long-lived, future, iat-less, malformed and missing tickets", () => {
    const check = (over: Partial<Fields>) => verifyTicket(signTicket(payload(over), keys.privateKey), keys.publicKey, NOW, "ws")
    expect(check({ exp: NOW })).toEqual({ ok: false, reason: "Expired workspace ticket" })
    expect(check({ w: "other" })).toEqual({ ok: false, reason: "The ticket is for another workspace" })
    expect(check({ exp: NOW + 15 * 60 + 1 })).toEqual({ ok: false, reason: "Workspace ticket lives too long" })
    expect(check({ iat: NOW + 31, exp: NOW + 100 })).toEqual({ ok: false, reason: "Workspace ticket issued in the future" })
    expect(check({ iat: NOW + 30, exp: NOW + 100 }).ok).toBe(true)
    const noIat = Buffer.from(JSON.stringify({ w: "ws", u: "u1", exp: NOW + 60 })).toString("base64url")
    const signed = `${noIat}.${sign(null, Buffer.from(noIat), keys.privateKey).toString("base64url")}`
    expect(verifyTicket(signed, keys.publicKey, NOW, "ws")).toEqual({ ok: false, reason: "Malformed workspace ticket" })
    expect(verifyTicket("a.b.c", keys.publicKey, NOW, "ws")).toEqual({ ok: false, reason: "Malformed workspace ticket" })
    expect(verifyTicket(undefined, keys.publicKey, NOW, "ws")).toEqual({ ok: false, reason: "Missing workspace ticket" })
    expect(() => verifyTicket("x", keys.publicKey, NOW, "")).toThrow("workspace id")
  })

  test("the public key is read from base64 of 32 raw bytes or PEM, and errors never repeat the value", () => {
    expect(ticketPublicKey(keys.publicKeyBase64).equals(keys.publicKey)).toBe(true)
    const pem = keys.publicKey.export({ format: "pem", type: "spki" }).toString()
    expect(ticketPublicKey(pem).equals(keys.publicKey)).toBe(true)
    expect(ticketPublicKeyFromEnv({ [TICKET_PUBLIC_KEY_ENV]: keys.publicKeyBase64 }).equals(keys.publicKey)).toBe(true)
    expect(() => ticketPublicKeyFromEnv({})).toThrow(`${TICKET_PUBLIC_KEY_ENV} is not set`)
    for (const bad of ["c2hvcnQ=", "not base64 at all!", keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString()]) {
      try {
        ticketPublicKey(bad)
        expect.unreachable()
      } catch (error) {
        expect((error as Error).message).toBe("The ticket public key must be an Ed25519 key: PEM, or base64 of its 32 raw bytes")
      }
    }
  })

  test("base paths take one form and refuse dot segments", () => {
    expect(normaliseBasePath("/p/demo/")).toBe("/p/demo")
    expect(normaliseBasePath("")).toBe("")
    expect(() => normaliseBasePath("/p/../x")).toThrow("Bad base path")
    expect(() => normaliseBasePath("p")).toThrow("Bad base path")
  })
})
