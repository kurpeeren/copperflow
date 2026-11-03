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
