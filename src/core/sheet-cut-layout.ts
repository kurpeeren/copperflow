// The layout file after a cut: each record keeps the copper it was drawn for, so the net it names is renamed where
// the cut renames that net. A net that crosses the boundary is the port's net now (an unnamed one was "net:C3.pin2"
// and is "C3_pin2"); a net that stays inside becomes the instance's own ("FB" is "F1/FB", "net:C3.pin1" takes its first
// pin's new designator); power and ground names stay global, and nets the cut does not reach keep their names.
import type { Net } from "../engine/model.js"
import { sortedNatural } from "../engine/order.js"
import { labelStyle } from "../engine/schematic-nets.js"
import { withBase } from "../engine/sheets.js"
import type { LayoutRecord } from "./layout-file.js"
import type { CutPlan } from "./sheet-cut.js"

const partOf = (pin: string): string => pin.split(".")[0] ?? pin

/** The name each record's net takes after the cut, from the nets of the design built before it. */
export function layoutNetRenamer(nets: readonly Net[], plan: Pick<CutPlan, "parts" | "mapping" | "crossings">, instance: string, base: number): (net: string) => string {
  const byRef = new Map<string, Net>()
  for (const net of nets) for (const name of net.names) if (!byRef.has(name)) byRef.set(name, net)
  for (const net of nets) byRef.set(net.id, net)
  const flat = new Map(plan.mapping.map(({ from, to }) => [from, withBase(to, base)]))
  const flatPin = (pin: string) => {
    const part = partOf(pin)
    const renamed = flat.get(part)
    return renamed === undefined ? pin : `${renamed}${pin.slice(part.length)}`
  }
  return (ref) => {
    const net = byRef.get(ref)
    if (!net || !net.pins.some((pin) => flat.has(partOf(pin)))) return ref
    const crossing = plan.crossings.find((c) => c.names.some((name) => net.names.includes(name)) || c.pins.some((pin) => net.pins.includes(pin)))
    if (crossing) return crossing.net
    const written = ref.startsWith("net.") ? ref.slice(4) : ref
    const name = net.names.includes(written) ? written : net.names[0]
    if (name !== undefined) return labelStyle(name) === "label" ? `${instance}/${name}` : name
    return `net:${sortedNatural(net.pins.map(flatPin))[0] ?? ""}`
  }
}

/** The records with their nets renamed, and whether any changed. */
export function renameRecordNets(records: readonly LayoutRecord[], rename: (net: string) => string): { records: LayoutRecord[]; changed: boolean } {
  let changed = false
  const renamed = records.map((record) => {
    if (record.net === undefined) return record
    const net = rename(record.net)
    if (net === record.net) return record
    changed = true
    return { ...record, net }
  })
  return { records: renamed, changed }
}
