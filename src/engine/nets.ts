import type { Net } from "./model.js"
import { naturalCompare, sortedNatural } from "./order.js"

/** Graph nodes are "pin:<pin id>" and "net:<name>", so a part called "net" cannot be mistaken for a net. */
export const pinNode = (pinId: string) => `pin:${pinId}`
export const netNode = (name: string) => `net:${name}`

class UnionFind {
  private readonly parent = new Map<string, string>()

  find(node: string): string {
    const parent = this.parent.get(node)
    if (parent === undefined) {
      this.parent.set(node, node)
      return node
    }
    if (parent === node) return node
    const root = this.find(parent)
    this.parent.set(node, root)
    return root
  }

  union(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent.set(rootA, rootB)
  }

  nodes(): string[] {
    return [...this.parent.keys()]
  }
}

/** Merges nodes joined by links. `nodes` are the ones that must exist even if no link reaches them. */
export function mergeNets(nodes: Iterable<string>, links: readonly (readonly [string, string])[]): Net[] {
  const sets = new UnionFind()
  for (const node of nodes) sets.find(node)
  for (const [a, b] of links) sets.union(a, b)
  const groups = new Map<string, string[]>()
  for (const node of sets.nodes()) {
    const root = sets.find(node)
    groups.set(root, [...(groups.get(root) ?? []), node])
  }
  return [...groups.values()].map(toNet).sort((a, b) => naturalCompare(a.id, b.id))
}

function toNet(group: readonly string[]): Net {
  const names = sortedNatural(group.filter((n) => n.startsWith("net:")).map((n) => n.slice(4)))
  const pins = sortedNatural(group.filter((n) => n.startsWith("pin:")).map((n) => n.slice(4)))
  const first = names[0]
  return { id: first !== undefined ? `net.${first}` : `net:${pins[0] ?? ""}`, names, pins }
}
