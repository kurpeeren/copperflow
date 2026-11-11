// copperflow's own EasyEDA-format documents for three real parts (test/fixtures/lcsc), and a fetch that answers
// from them. They are written for copperflow from the packages' standard drawings, not recorded copies of the EasyEDA
// library (see docs/licences.md), and no test reaches the network.
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const lcscFixture = (lcsc: string): unknown => JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "lcsc", `${lcsc}.json`), "utf8"))

/** A fetch that answers every LCSC number with its fixture (404 for others), and records the URLs asked for. */
export function fixtureFetch(): typeof fetch & { calls: string[] } {
  const calls: string[] = []
  const fake = async (url: string | URL | Request) => {
    const text = String(url)
    calls.push(text)
    const lcsc = /products\/(C\d+)\//.exec(text)?.[1] ?? ""
    try {
      return new Response(JSON.stringify(lcscFixture(lcsc)), { status: 200 })
    } catch {
      return new Response(JSON.stringify({ success: false, code: 404, message: "Component not found" }), { status: 404 })
    }
  }
  return Object.assign(fake as typeof fetch, { calls })
}

/** A fetch that fails as Node's does without a connection. */
export const offlineFetch = (async () => {
  throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })
}) as typeof fetch

/** The real fetch, replaced so that a test reaching the network fails loudly. */
export const noNetwork = (async (url: string | URL | Request) => {
  throw new Error(`a test tried to fetch ${String(url)}`)
}) as typeof fetch
