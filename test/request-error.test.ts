import { describe, expect, it } from "vitest"
import { SERVER_GONE_MESSAGE, STALE_KEY_MESSAGE, isStaleKey, networkErrorText, requestErrorText } from "../studio/src/request-error.js"

describe("requestErrorText", () => {
  it("names an out of date key when the server refuses the session token", () => {
    expect(requestErrorText(403, "Missing or wrong session token")).toBe(STALE_KEY_MESSAGE)
    expect(STALE_KEY_MESSAGE).toBe("This tab's key is out of date. Open the address printed by `copperflow studio` again.")
  })

  it("keeps the server's words for other refusals", () => {
    expect(requestErrorText(403, "Cross-origin requests are not allowed")).toBe("Cross-origin requests are not allowed")
    expect(requestErrorText(400, "Missing file")).toBe("Missing file")
  })

  it("falls back to the status when the server gives no words", () => {
    expect(requestErrorText(500, undefined)).toBe("Request failed (500)")
  })

  it("tells the out of date key apart from other messages", () => {
    expect(isStaleKey(STALE_KEY_MESSAGE)).toBe(true)
    expect(isStaleKey("Missing file")).toBe(false)
  })
})

describe("the server is gone", () => {
  it("says the server is not answering when a request fails at the network level", () => {
    expect(SERVER_GONE_MESSAGE).toBe('The copperflow Studio server is not answering. Start "copperflow studio" again in the project folder, then reload this page.')
    expect(networkErrorText(new TypeError("Failed to fetch"))).toBe(SERVER_GONE_MESSAGE)
  })

  it("keeps the message of any other failure", () => {
    expect(networkErrorText(new Error("Missing file"))).toBe("Missing file")
  })

  it("leaves a cancelled request alone", () => {
    expect(networkErrorText(new DOMException("aborted", "AbortError"))).toBe("aborted")
  })
})
