// copperflow simulate and copperflow spice: the simulate tool's answer, and the netlist for another simulator.
import { writeFile } from "node:fs/promises"
import type { DesignSource } from "./core/design-source.js"
import { simulate, spiceText, type SimulateInput } from "./core/simulate.js"
import { resolveInRoot } from "./core/workspace.js"

const SET = /^([^=]+)=(open|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i

/** The options of simulate and spice: --set net=volts (again for each), --sheet, --closed and --coil (comma lists), --all, --out. */
function parseArgs(args: readonly string[]): SimulateInput & { out?: string } {
  const [file, ...rest] = args
  if (file === undefined || file.startsWith("--")) throw new Error('Missing file. Run "copperflow help".')
  const input: SimulateInput & { out?: string } = { file }
  const set: Record<string, number | "open"> = {}
  for (let k = 0; k < rest.length; k++) {
    const flag = rest[k]
    if (flag === "--all") {
      input.all = true
      continue
    }
    const value = rest[++k]
    if (value === undefined) throw new Error(`Missing ${flag} value. Run "copperflow help".`)
    if (flag === "--set") {
      const match = SET.exec(value)
      if (!match) throw new Error(`--set takes net=volts or net=open, e.g. --set V12=12; got "${value}"`)
      set[match[1] as string] = (match[2] as string).toLowerCase() === "open" ? "open" : Number(match[2])
    } else if (flag === "--sheet") input.sheet = value
    else if (flag === "--closed") input.closed = value.split(",")
    else if (flag === "--coil") input.coil = value.split(",")
    else if (flag === "--out") input.out = value
    else throw new Error(`Unknown option ${flag}. Run "copperflow help".`)
  }
  if (Object.keys(set).length > 0) input.set = set
  return input
}

export async function simulateCommand(root: string, args: readonly string[], engine?: DesignSource): Promise<string> {
  return simulate(root, parseArgs(args), engine)
}

export async function spiceCommand(root: string, args: readonly string[], engine?: DesignSource): Promise<string> {
  const { out, ...input } = parseArgs(args)
  const text = await spiceText(root, input, engine)
  if (out === undefined) return text.trimEnd()
  await writeFile(resolveInRoot(root, out), text)
  return `Wrote ${out} (SPICE3 netlist; copperflow runs no simulator)`
}
