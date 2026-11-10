// R5 and C3 (and R6 on the data bus) are cut out; R7 and R8 stay.
export const CUT_MAIN = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R5" resistance="1k" schX={2} schY={1} pcbX={4} pcbY={2} />
    <capacitor name="C3" capacitance="100nF" schX={4} schY={1} pcbX={6} pcbY={2} />
    <resistor name="R6" resistance="10k" schX={3} schY={3} />
    <resistor name="R7" resistance="2k" schX={10} schY={1} />
    <resistor name="R8" resistance="2k" schX={10} schY={3} />
    <bus name="D[0:3]" points={[{ x: 6, y: 3 }, { x: 9, y: 3 }]} />
    <trace from="R5.pin2" to="C3.pin1" schematicRouteHints={[{ x: 3, y: 1.5 }]} />
    <trace from="R5.pin1" to="net.VIN" />
    <trace from="R7.pin1" to="net.VIN" />
    <trace from="C3.pin2" to="R7.pin2" />
    <trace from="R6.pin1" to="net.D1" />
    <trace from="R6.pin2" to="net.GND" />
    <trace from="R8.pin1" to="net.D1" />
  </board>
)
`
