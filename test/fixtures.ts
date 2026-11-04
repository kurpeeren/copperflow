import type { Part } from "../src/core/library.js"

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
