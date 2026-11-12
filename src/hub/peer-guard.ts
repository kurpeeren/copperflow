// Who may talk to the hub's listener. With network reach the hub's container sits on every workspace's network, so a
// workspace could connect to the hub directly, skipping the TLS proxy: the hub records each workspace network's subnet
// and closes any connection from inside one before a byte of it is read. X-Forwarded-For is honoured only from the
// proxy's own address or CIDR (--trust-proxy <address|CIDR>).
import { BlockList, isIP } from "node:net"

/** A subnet such as 172.18.0.0/16 or fd00::/64. */
export interface Subnet {
  address: string
  prefix: number
}

/** Parses "a.b.c.d", "a.b.c.d/n", "v6" or "v6/n"; undefined when it is none of these. */
export function parseCidr(text: string): Subnet | undefined {
  const [address, bits] = text.trim().split("/")
  const family = isIP(address ?? "")
  if (!address || family === 0) return undefined
  const max = family === 4 ? 32 : 128
  const prefix = bits === undefined ? max : Number(bits)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (bits !== undefined && !/^[0-9]{1,3}$/.test(bits))) return undefined
  return { address, prefix }
}

function familyOf(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 4 ? "ipv4" : "ipv6"
}

/**
 * A set of subnets, matched against peer addresses (an IPv4-mapped IPv6 peer is matched as IPv4). Counted: two
 * networks may be given the same subnet over time, and a subnet stays refused until every one that added it removed it.
 */
export class SubnetSet {
  private readonly subnets = new Map<string, { subnet: Subnet; count: number }>()
  private list = new BlockList()

  add(subnet: Subnet): void {
    const key = `${subnet.address}/${subnet.prefix}`
    const known = this.subnets.get(key)
    this.subnets.set(key, { subnet, count: (known?.count ?? 0) + 1 })
    this.rebuild()
  }

  remove(subnet: Subnet): void {
    const key = `${subnet.address}/${subnet.prefix}`
    const known = this.subnets.get(key)
    if (!known) return
    if (known.count > 1) this.subnets.set(key, { subnet, count: known.count - 1 })
    else this.subnets.delete(key)
    this.rebuild()
  }

  has(peer: string | undefined): boolean {
    if (!peer) return false
    const plain = peer.startsWith("::ffff:") && isIP(peer.slice(7)) === 4 ? peer.slice(7) : peer
    if (isIP(plain) === 0) return false
    return this.list.check(plain, familyOf(plain))
  }

  get size(): number {
    return this.subnets.size
  }

  private rebuild(): void {
    const list = new BlockList()
    for (const { subnet } of this.subnets.values()) list.addSubnet(subnet.address, subnet.prefix, familyOf(subnet.address))
    this.list = list
  }
}

/** The subnets of the workspace networks that exist now (one hub per process). */
export const workspaceSubnets = new SubnetSet()

/** The trusted proxy for --trust-proxy: true means this machine's loopback (tests and a proxy on the same host). */
export function trustedProxies(trust: boolean | string | undefined): SubnetSet | undefined {
  if (trust === undefined || trust === false) return undefined
  const set = new SubnetSet()
  const texts = trust === true ? ["127.0.0.1/32", "::1/128"] : trust.split(",")
  for (const text of texts) {
    const subnet = parseCidr(text)
    if (!subnet) throw new Error(`--trust-proxy must be the proxy's address or CIDR (such as 10.0.0.2 or 172.20.0.0/16), not "${text}"`)
    set.add(subnet)
  }
  return set
}
