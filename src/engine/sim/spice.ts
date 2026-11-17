// The same circuit as a SPICE netlist for another simulator, in SPICE3 syntax as the ngspice manual documents it:
// "Circuit Description" (title line, comments, .end), "Elementary Devices: Resistors", "Voltage and Current Sources:
// Independent Sources", "Diodes: Junction Diodes / Diode Model (D)" (IS, N, RS, BV, IBV, NBV), "BJTs: Bipolar Junction
// Transistors / BJT Models" (IS, BF, BR), "MOSFETs: MOSFET devices / MOSFET models, level 1" (VTO, KP; W = L = 1 so
// the drain current is KP / 2 (vgs - VTO)²) and ".op: Operating Point Analysis". Nothing is run by copperflow.
import type { Circuit } from "../model.js"
import { HONEST_LINE } from "./answer.js"
import type { DiodeModel } from "./devices.js"
import { VT } from "./devices.js"
import { buildSimCircuit, type SimRequest } from "./from-circuit.js"
import type { Model } from "./model-schema.js"

const number = (value: number) => String(Number(value.toPrecision(6)))
const safe = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_")

function diodeCard(name: string, model: DiodeModel): string {
  const breakdown = model.breakdown ? ` BV=${number(model.breakdown.vz)} IBV=${number(model.breakdown.iz)} NBV=${number(model.breakdown.nvt / VT)}` : ""
  return `.model ${name} D(IS=${number(model.is)} N=${number(model.n)} RS=${number(model.rs)}${breakdown})`
}

/** One comment line a part that is not an element: open at DC, a short, or not modelled. */
function partComments(circuit: Circuit, inParts: ReadonlySet<string>, unmodelled: ReadonlySet<string>): string[] {
  return circuit.components.flatMap((component) => {
    if (inParts.has(component.id) && !unmodelled.has(component.id)) return []
    if (unmodelled.has(component.id)) return [`* ${component.id} ${component.library ? `part ${component.library}` : component.kind}: not modelled, its pins draw nothing${inParts.has(component.id) ? " but the loads above" : ""}`]
    if (["fuse", "inductor", "switch", "pushbutton"].includes(component.kind)) return [`* ${component.id} ${component.kind}: a short or open as the request chose; its nets are joined or apart above`]
    return [`* ${component.id} ${component.kind}: open at DC`]
  })
}

/** The netlist, or a comment block with the reasons it cannot be written. */
export function spiceNetlist(circuit: Circuit, models: ReadonlyMap<string, Model>, request: SimRequest, file: string): string {
  const built = buildSimCircuit(circuit, models, request)
  const head = [`* copperflow netlist of ${file}, SPICE3 syntax as the ngspice manual documents it`, `* ${HONEST_LINE}`]
  if ("refused" in built) return [...head, ...built.refused.map((line) => `* not written: ${line}`), ".end", ""].join("\n")
  const used = new Set<string>()
  const names = built.sim.nodes.map((name) => {
    let candidate = safe(name) === "0" ? "N0" : safe(name)
    for (let k = 2; used.has(candidate.toUpperCase()); k++) candidate = `${safe(name)}_${k}`
    used.add(candidate.toUpperCase())
    return candidate
  })
  const node = (n: number) => (n === 0 ? "0" : (names[n - 1] ?? `N${n}`))
  const lines = [...head, ...built.sim.sources.map((source) => `V_${safe(source.name)} ${node(source.node)} 0 DC ${number(source.volts)}`)]
  built.sim.elements.forEach((element, index) => {
    const id = safe(element.part)
    switch (element.kind) {
      case "resistor":
        return lines.push(`R_${id} ${node(element.a)} ${node(element.b)} ${number(element.ohms)}`)
      case "load":
        return lines.push(`I_${id}_${index} ${node(element.node)} 0 DC ${number(element.amps)}`)
      case "diode":
        return lines.push(`D_${id} ${node(element.anode)} ${node(element.cathode)} DM_${id}`, diodeCard(`DM_${id}`, element.model))
      case "mos": {
        const type = element.polarity === 1 ? "NMOS" : "PMOS"
        const [anode, cathode] = element.polarity === 1 ? [element.source, element.drain] : [element.drain, element.source]
        return lines.push(
          `M_${id} ${node(element.drain)} ${node(element.gate)} ${node(element.source)} ${node(element.source)} MM_${id} L=1 W=1`,
          `.model MM_${id} ${type}(LEVEL=1 VTO=${number(element.polarity * element.model.vth)} KP=${number(element.model.k)})`,
          `D_${id}_BODY ${node(anode)} ${node(cathode)} DM_${id}_BODY`,
          diodeCard(`DM_${id}_BODY`, element.model.body),
        )
      }
      case "bjt":
        return lines.push(
          `Q_${id} ${node(element.collector)} ${node(element.base)} ${node(element.emitter)} QM_${id}`,
          `.model QM_${id} ${element.polarity === 1 ? "NPN" : "PNP"}(IS=${number(element.model.is)} BF=${number(element.model.bf)} BR=${number(element.model.br)})`,
        )
    }
  })
  const inParts = new Set(built.parts.map((part) => part.name))
  const unmodelled = new Set(built.unmodelled.map((part) => part.part))
  return [...lines, ...partComments(circuit, inParts, unmodelled), ".op", ".end", ""].join("\n")
}
