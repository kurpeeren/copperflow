import type { NewCircuit } from "../../src/core/new-circuit.js"

/** A regulator stage written once and used twice. */
export const STAGE_SPEC: NewCircuit = {
  parts: [{ name: "J1", kind: "connector", props: { pinCount: 2 } }],
  nets: { VBUS: ["J1.pin1"], GND: ["J1.pin2"] },
  sheets: {
    PowerStage: {
      parts: [
        { name: "U1", kind: "chip", props: { pinLabels: { pin1: "IN", pin2: "OUT", pin3: "GND" } } },
        { name: "C1", kind: "capacitor", value: "1uF" },
        { name: "R1", kind: "resistor", value: "10k" },
      ],
      nets: { VIN: ["U1.IN"], VOUT: ["U1.OUT", "C1.pin1", "R1.pin1"], GND: ["U1.GND", "C1.pin2"], FB: ["R1.pin2"] },
      ports: ["VIN", "VOUT", "GND"],
    },
  },
  instances: [
    { sheet: "PowerStage", name: "PS1", connections: { VIN: "VBUS", VOUT: "V3_3", GND: "GND" } },
    { sheet: "PowerStage", name: "PS2", connections: { VIN: "V3_3", VOUT: "V1_8", GND: "GND" } },
  ],
}
