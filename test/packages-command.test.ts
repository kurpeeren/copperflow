import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { formatPackages, noPackageText, packagesText } from "../src/core/packages.js"
import { findPackages, PACKAGES } from "../src/engine/footprints/catalogue.js"
import { generateFootprint } from "../src/engine/footprints/index.js"
import { createGuideMemory, guide, guideInSession } from "../src/mcp/guide.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const NL = "\n"
/** Escapes the dot of a footprint string inside a regular expression. */
const ESC = "\\."

/** The most characters the whole `packages` answer may have: it is read by agents, once. */
const WHOLE_LIST_LIMIT = 9000

async function cli(...args: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, "/nowhere-copperflow-packages", { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })
  return { code, out: out.join("\n"), err: err.join("\n") }
}

describe("formatPackages", () => {
  const text = formatPackages(findPackages(["soic"]))
  const lines = text.split("\n")

  test("a heading per group, then one line per package: string, name, pads, size, mount", () => {
    expect(lines).toContain("ICs with leads")
    const soic8 = lines.find((line) => line.trimStart().startsWith("soic8 "))
    expect(soic8).toMatch(/^ {2}soic8 +SOIC-8, 3\.9 mm +8 {2}\d+(\.\d)?x\d+(\.\d)? {2}smd$/)
  })

  test("the pads, size and mount come from the generated footprint", () => {
    const dip = formatPackages(findPackages(["dip8"])).split("\n").find((line) => line.startsWith("  dip8 "))
    expect(dip).toMatch(/ 8 {2}\S+ {2}th$/)
  })

  test("columns are aligned within a group", () => {
    const rows = lines.filter((line) => line.startsWith("  "))
    const nameAt = rows.map((line) => (/^ {2}\S+ +/.exec(line) as RegExpExecArray)[0].length)
    expect(new Set(nameAt).size).toBe(1)
  })

  test("groups with no package are left out, and the other strings show only when asked for", () => {
    expect(lines).not.toContain("Diodes")
    expect(formatPackages(findPackages(["sma"]))).not.toContain("also")
    expect(formatPackages(findPackages(["sma"]), { also: true })).toContain("(also do214ac)")
  })

  test("the general forms come at the end when asked for", () => {
    expect(text).not.toContain("General forms")
    const whole = formatPackages(PACKAGES, { forms: true })
    expect(whole.split("\n").slice(-3).join("\n")).toMatch(/footprint\.yaml/)
    expect(whole).toContain("qfn<N>_<b>x<b>_p<pitch>[_ep<size>]")
  })

  test("hideExtras leaves the extras out and counts them; without it every size is listed", () => {
    const extras = PACKAGES.filter((one) => one.extra === true)
    const short = formatPackages(PACKAGES, { hideExtras: true })
    for (const entry of extras) expect(short).not.toMatch(new RegExp(`^ {2}${entry.footprint.replace(/[.]/g, ESC)} `, "m"))
    expect(short.split(NL).at(-1)).toContain(`${extras.length} more sizes`)
    expect(formatPackages(PACKAGES)).not.toContain("more sizes")
    expect(formatPackages(PACKAGES.filter((one) => one.extra !== true), { hideExtras: true })).not.toContain("more sizes")
  })

  test("every package of the catalogue gets a line", () => {
    const whole = formatPackages(PACKAGES)
    for (const entry of PACKAGES) expect(whole, entry.footprint).toMatch(new RegExp(`^ {2}${entry.footprint.replace(/[.]/g, "\\.")} `, "m"))
  })
})

describe("packagesText", () => {
  test("no words gives the whole list with the general forms, a search gives the matches with their other strings", () => {
    const whole = packagesText([])
    expect(whole.found).toBe(true)
    expect(whole.text).toContain("General forms")
    const some = packagesText(["sc70"])
    expect(some.text).toContain("sot323")
    expect(some.text).toContain("(also sc70)")
    expect(some.text).not.toContain("General forms")
  })

  test("a search with no match says so and names the nearest strings when the word looks like one", () => {
    const none = packagesText(["tssop30"])
    expect(none.found).toBe(false)
    expect(none.text).toMatch(/^No package matches "tssop30"\. Nearest strings: tssop\d+/)
    expect(noPackageText(["zzzz", "yyyy"])).toBe('No package matches "zzzz yyyy". Search with no words lists them all.')
  })
})

describe("copperflow packages", () => {
  test("prints the packages that match, and exits 0", async () => {
    const result = await cli("packages", "sot")
    expect(result.code).toBe(0)
    expect(result.err).toBe("")
    expect(result.out).toContain("sot23_5")
    expect(result.out).toContain("sot223")
    expect(result.out).not.toContain("soic8")
  })

  test("every word has to match", async () => {
    const result = await cli("packages", "sot", "5")
    expect(result.out).toContain("sot23_5")
    expect(result.out).not.toContain("  sot23  ")
  })

  test("no words prints the packages that are not extras, and says how many more a search shows", async () => {
    const result = await cli("packages")
    expect(result.code).toBe(0)
    for (const entry of PACKAGES.filter((one) => one.extra !== true)) expect(result.out).toMatch(new RegExp(`^ {2}${entry.footprint.replace(/[.]/g, ESC)} `, "m"))
    expect(result.out).not.toMatch(/^ {2}dip24_w15\.24 /m)
    expect(result.out.split(NL).at(-1)).toBe(`${PACKAGES.filter((one) => one.extra === true).length} more sizes are left out here; a search lists them (packages dip, packages qfn).`)
  })

  test("a search shows the extras", async () => {
    const result = await cli("packages", "dip")
    expect(result.out).toMatch(/^ {2}dip24_w15\.24 /m)
    expect(result.out).toMatch(/^ {2}dip6 /m)
    expect(result.out).not.toContain("more sizes are left out")
  })

  test("no match prints a line and exits 1, naming the nearest strings", async () => {
    const result = await cli("packages", "tssop30")
    expect(result.code).toBe(1)
    expect(result.out).toMatch(/^No package matches "tssop30"\. Nearest strings: /)
    const near = /Nearest strings: ([^.]*)\./.exec(result.out)?.[1]?.split(", ") ?? []
    expect(near.length).toBeGreaterThanOrEqual(2)
    for (const text of near) expect("error" in generateFootprint(text), text).toBe(false)
  })

  test("the help lists the command", async () => {
    const result = await cli("help")
    expect(result.out).toMatch(/copperflow packages \[words\.\.\.\]/)
  })
})

describe("the guide topic packages", () => {
  test("answers the same text as the command, made at call time", async () => {
    expect(await guide({ topic: "packages" })).toBe(packagesText([]).text)
  })

  test("words after the topic narrow the answer", async () => {
    const text = await guide({ topic: "packages sot 5" })
    expect(text).toBe(packagesText(["sot", "5"]).text)
    expect(text).toContain("sot23_5")
    expect(text.length).toBeLessThan(2000)
  })

  test("a search that finds nothing is an answer, not an error", async () => {
    expect(await guide({ topic: "packages zzzz" })).toMatch(/^No package matches "zzzz"/)
  })

  test("a search includes the extras, the unfiltered text does not", async () => {
    expect(await guide({ topic: "packages qfn28" })).toContain("qfn28_5x5_p0.5")
    expect(await guide({ topic: "packages" })).not.toContain("qfn28_5x5_p0.5")
  })

  test("the unfiltered list stays under the limit and says nothing it should not", async () => {
    const text = await guide({ topic: "packages" })
    expect(text.length, `the whole packages text is ${text.length} characters`).toBeLessThanOrEqual(WHOLE_LIST_LIMIT)
    expect(text.toLowerCase()).not.toMatch(/tscircuit|claude|\bai\b/)
  })

  test("is remembered by its words: the same words get the short line, other words the text", async () => {
    const memory = createGuideMemory()
    const first = await guideInSession(memory, { topic: "packages sot" })
    expect(await guideInSession(memory, { topic: "Packages  sot" })).toMatch(/already returned/)
    expect(await guideInSession(memory, { topic: "packages soic" })).not.toBe(first)
  })

  test("goes through the guide tool, and the unknown-topic error names it", async () => {
    const server = createCopperflowServer("/nowhere-copperflow-packages", { engine: inProcessEngine as never })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
    const answer = await client.callTool({ name: "guide", arguments: { topic: "packages crystal" } })
    const text = (answer.content as Array<{ text: string }>)[0]?.text ?? ""
    expect(answer.isError).toBeFalsy()
    expect(text).toContain("hc49s")
    const bad = await client.callTool({ name: "guide", arguments: { topic: "nonsense" } })
    expect((bad.content as Array<{ text: string }>)[0]?.text).toContain("packages")
  })
})

describe("searching packages the way people write them", () => {
  test("a dash or a space where the string has an underscore still finds it", () => {
    for (const words of [["usb-c"], ["USB", "C"], ["usb_c"]]) expect(packagesText(words).text, words.join(" ")).toContain("usb_c16")
  })

  test("words no single package has all of list the packages with any of them, and say so", () => {
    const { text, found } = packagesText(["ssop16", "soic16"])
    expect(found).toBe(true)
    expect(text.split(NL)[0]).toBe('No package has all of "ssop16 soic16"; each below has one of the words.')
    expect(text).toMatch(/^\s+ssop16\s/m)
    expect(text).toMatch(/^\s+soic16\s/m)
  })

  test("a family's name finds its general form, even with no listed size", () => {
    for (const words of [["esop"], ["exposed", "pad"], ["powerpad"]]) {
      const { text, found } = packagesText(words)
      expect(found, words.join(" ")).toBe(true)
      expect(text, words.join(" ")).toContain("soic<N>_ep<w>x<h>")
    }
    expect(packagesText(["terminal", "block"]).text).toContain("screw<N>")
  })

  test("nothing at all still answers the no-match line", () => {
    expect(packagesText(["zzqq"]).found).toBe(false)
  })
})
