import { describe, expect, test } from "vitest"
import { EventEmitter } from "node:events"
import type { IncomingMessage } from "node:http"
import { clientAddress } from "../src/hub/http.js"
import { parseCidr, SubnetSet, trustedProxies } from "../src/hub/peer-guard.js"
import { refuseWorkspacePeers } from "../src/hub/server.js"

const request = (peer: string, forwarded?: string) =>
  ({ socket: { remoteAddress: peer }, headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded } }) as unknown as IncomingMessage

describe("who may talk to the hub", () => {
  test("a connection from inside a workspace network is closed before anything is read", () => {
    const subnets = new SubnetSet()
    subnets.add(parseCidr("172.30.0.0/16") as never)
    subnets.add(parseCidr("fd00:30::/64") as never)
    const server = new EventEmitter()
    refuseWorkspacePeers(server as never, subnets)
    const sockets = ["172.30.0.5", "::ffff:172.30.9.9", "fd00:30::7", "172.31.0.5", "127.0.0.1"].map((remoteAddress) => {
      const socket = { remoteAddress, destroyed: false, destroy: () => void (socket.destroyed = true) }
      server.emit("connection", socket)
      return socket
    })
    expect(sockets.map((socket) => socket.destroyed)).toEqual([true, true, true, false, false])
    subnets.remove(parseCidr("172.30.0.0/16") as never)
    expect(subnets.has("172.30.0.5")).toBe(false)
  })

  test("X-Forwarded-For is honoured only from the trusted proxy's address or CIDR", () => {
    const proxy = trustedProxies("10.0.0.2,172.20.0.0/16")
    expect(clientAddress(request("10.0.0.2", "203.0.113.7"), proxy)).toBe("203.0.113.7")
    expect(clientAddress(request("172.20.3.4", "1.2.3.4, 203.0.113.8"), proxy)).toBe("203.0.113.8")
    // A workspace (or anyone else) sending the header is taken at its own address.
    expect(clientAddress(request("172.30.0.5", "203.0.113.9"), proxy)).toBe("172.30.0.5")
    expect(clientAddress(request("10.0.0.2", "203.0.113.7"), undefined)).toBe("10.0.0.2")
    expect(clientAddress(request("127.0.0.1", "203.0.113.7"), trustedProxies(true))).toBe("203.0.113.7")
    expect(() => trustedProxies("proxy.example.com")).toThrow(/address or CIDR/)
    expect(() => trustedProxies("10.0.0.0/33")).toThrow(/address or CIDR/)
  })
})
