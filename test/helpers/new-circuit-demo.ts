/** The netlist of examples/usb-c-ldo/index.circuit.tsx, as new_circuit takes it. */
export const DEMO = {
  file: "rebuilt.circuit.tsx",
  board: { width: 30, height: 18 },
  parts: [
    { name: "J1", part: "TYPE-C-6P" },
    { name: "R1", kind: "resistor", value: "5.1k", footprint: "0402" },
    { name: "R2", kind: "resistor", value: "5.1k", footprint: "0402" },
    { name: "C1", kind: "capacitor", value: "1uF", footprint: "0603" },
    { name: "U1", part: "AP2112K-3.3" },
    { name: "C2", kind: "capacitor", value: "1uF", footprint: "0603" },
    { name: "R3", kind: "resistor", value: "1k", footprint: "0402" },
    { name: "LED1", kind: "led", props: { color: "red", pinLabels: { pin1: "cathode", pin2: "anode" } }, footprint: "0603" },
    { name: "J2", kind: "pinheader", props: { pinCount: 2, pitch: "2.54mm", gender: "male" } },
  ],
  nets: {
    VBUS: ["J1.VBUS1", "J1.VBUS2", "C1.pin1", "U1.VIN", "U1.EN"],
    GND: ["J1.GND1", "J1.GND2", "J1.EH", "R1.pin2", "R2.pin2", "C1.pin2", "U1.GND", "C2.pin2", "LED1.cathode", "J2.pin2"],
    CC1: ["J1.CC1", "R1.pin1"],
    CC2: ["J1.CC2", "R2.pin1"],
    V3_3: ["U1.VOUT", "C2.pin1", "R3.pin1", "J2.pin1"],
    LED_A: ["R3.pin2", "LED1.anode"],
  },
}
