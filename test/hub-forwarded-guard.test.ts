import { afterEach, describe, expect, test } from "vitest"
import { request } from "node:http"
import { workspaceSubnets } from "../src/hub/peer-guard.js"
import { refuseForwardedWorkspaceClient, type HubServer } from "../src/hub/server.js"
import { SubnetSet } from "../src/hub/peer-guard.js"
import { ORIGIN, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  workspaceSubnets.remove({ address: "10.99.0.0", prefix: 16 })
})

function get(url: string, forwarded: string | undefined): Promise<{ status: number } | "closed"> {
  const target = new URL(url)
  return new Promise((done) => {
    const req = request({ agent: false, host: target.hostname, port: target.port, path: "/healthz", headers: { host: new URL(ORIGIN).host, ...(forwarded ? { "x-forwarded-for": forwarded } : {}) } }, (res) => {
      res.resume()
      res.on("end", () => done({ status: res.statusCode ?? 0 }))
    })
    req.on("error", () => done("closed"))
    req.end()
  })
}

describe("the peer guard also checks the forwarded client address", () => {
  test("through a trusted proxy, a client inside a workspace subnet gets the connection closed; others are served", async () => {
    workspaceSubnets.add({ address: "10.99.0.0", prefix: 16 })
    server = await startTestHub({ trustProxy: true })
    expect(await get(server.url, "203.0.113.7")).toEqual({ status: 200 })
    expect(await get(server.url, "10.99.3.4")).toBe("closed")
    // The last entry is the one the proxy added; an earlier, client-supplied one is not trusted or checked.
    expect(await get(server.url, "10.99.3.4, 203.0.113.7")).toEqual({ status: 200 })
    expect(await get(server.url, "198.51.100.1, 10.99.3.4")).toBe("closed")
  })

  test("without a trusted proxy the header is ignored, as before", async () => {
    workspaceSubnets.add({ address: "10.99.0.0", prefix: 16 })
    server = await startTestHub()
    expect(await get(server.url, "10.99.3.4")).toEqual({ status: 200 })
  })

  test("the check itself: same address as the peer is the socket guard's business, not this one's", () => {
    const subnets = new SubnetSet()
    subnets.add({ address: "10.99.0.0", prefix: 16 })
    const req = { socket: { remoteAddress: "10.99.0.5", destroy: () => undefined }, headers: {} } as never
    expect(refuseForwardedWorkspaceClient(req, subnets, subnets)).toBe(false)
  })
})
