/** A one-page circuit whose schematic layout was saved (pre-pages-layout.json) by the engine before pages existed. */
export const BODY = [
  `<chip name="U1" pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "VOUT" }} />`,
  `<capacitor name="C1" />`,
  `<capacitor name="C2" />`,
  `<resistor name="R1" schX={6} schY={2} />`,
  `<led name="D1" />`,
  `<trace from="U1.VIN" to="net.VBUS" />`,
  `<trace from="C1.pin1" to="net.VBUS" />`,
  `<trace from="U1.GND" to="net.GND" />`,
  `<trace from="C1.pin2" to="net.GND" />`,
  `<trace from="C2.pin2" to="net.GND" />`,
  `<trace from="U1.VOUT" to="net.V3_3" />`,
  `<trace from="C2.pin1" to="net.V3_3" />`,
  `<trace from="R1.pin1" to="net.V3_3" schematicRouteHints={[{ x: 6, y: 3 }]} />`,
  `<trace from="R1.pin2" to="D1.anode" />`,
  `<trace from="D1.cathode" to="net.GND" />`,
  `<schematictext name="Title" x={0} y={4} text="LDO" />`,
].join("\n")
