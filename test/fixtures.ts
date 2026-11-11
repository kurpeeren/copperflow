import type { Part } from "../src/core/library.js"
import type { FootprintFile } from "../src/engine/footprints/file.js"

export const LDO: Part = {
  title: "AP2112K-3.3 LDO regulator",
  manufacturer: "Diodes Incorporated",
  mpn: "AP2112K-3.3TRG1",
  footprint: "sot23_5",
  pins: {
    "1": { name: "VIN", type: "power_in" },
    "2": { name: "GND", type: "ground" },
    "3": { name: "EN", type: "input" },
    "4": { name: "NC", type: "no_connect" },
    "5": { name: "VOUT", type: "power_out" },
  },
  suppliers: { jlcpcb: "C51118" },
  datasheet: { url: "https://www.diodes.com/assets/Datasheets/AP2112.pdf" },
}

/** A part whose footprint comes from a file; pin 5 (the shell) has two pads. */
export const USBX: Part = {
  title: "USB-C receptacle",
  footprint: "footprint.yaml",
  pins: {
    "1": { name: "VBUS", type: "power_in" },
    "2": { name: "GND", type: "ground" },
    "3": { name: "DP", type: "bidirectional" },
    "4": { name: "DN", type: "bidirectional" },
    "5": { name: "SHELL", type: "passive" },
  },
}

export const USBX_FOOTPRINT: FootprintFile = {
  pads: [
    { number: "1", shape: "rect", x: -1.5, y: 1, width: 0.6, height: 1.2 },
    { number: "2", shape: "rect", x: -0.5, y: 1, width: 0.6, height: 1.2 },
    { number: "3", shape: "rect", x: 0.5, y: 1, width: 0.6, height: 1.2 },
    { number: "4", shape: "rect", x: 1.5, y: 1, width: 0.6, height: 1.2 },
    { number: "5", shape: "oval", x: -4, y: -1, width: 1, height: 2, layers: "through", drill: { width: 0.6, height: 1.4 } },
    { number: "5", shape: "oval", x: 4, y: -1, width: 1, height: 2, layers: "through", drill: { width: 0.6, height: 1.4 } },
  ],
}

/** create_part's arguments for a part: its fields, with the footprint as the package. */
export function createPartArgs(id: string, part: Part, footprintFile?: FootprintFile): Record<string, unknown> {
  const { footprint, ...fields } = part
  return { id, ...fields, package: footprint === "footprint.yaml" ? { file: footprint } : footprint, ...(footprintFile ? { footprint_file: footprintFile } : {}) }
}

/** The module BOARD imports. */
export const SHARED = `export const regulatorProps = { footprint: "sot23_5", pinCount: 5 }; export const offset = 1`

export const BOARD = `import { regulatorProps, offset } from "./shared"

export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="5.1k" footprint="0402" pcbX={-4} pcbY={2} />
    <capacitor
      name="C1"
      capacitance="1uF"
      footprint="0402"
      pcbX={3}
    />
    <led name="LED1" color="red" pcbX={offset + 2} />
    {[1, 2].map((i) => (
      <resistor name="RX" resistance="1k" />
    ))}
    <chip name="U1" {...regulatorProps} />
    <resistor name={"R" + 9} resistance="1k" />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".C1 > .pin1" to=".R1 > .pin2" />
  </board>
)
`

/** Schematic drawings: named, unnamed, a bus drawn in two pieces, and a text placed by an expression. */
export const DRAWINGS = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" schX={0} schY={0} />
    <schematicrect name="G1" x={1} y={2} width={3} height={1.5} />
    <schematicpath points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} strokeWidth={0.02} />
    <schematicpath points={[{ x: 0, y: 1 }, { x: 1, y: 1 }]} />
    <bus name="D[0:7]" points={[{ x: 0, y: 3 }, { x: 4, y: 3 }]} />
    <bus name="D[0:7]" points={[{ x: 4, y: 3 }, { x: 4, y: 5 }]} />
    <schematictext name="G2" x={1 + 1} y={1} text="Power" />
    <trace from=".R1 > .pin1" to="net.GND" />
  </board>
)
`
