export default () => (
  <board kind="stripboard" columns={20} rows={19} pcbX={-2.54} pcbY={3.81}>
    <connector name="J1" footprint="screw2" pinLabels={{ pin1: "V24", pin2: "GND" }} pcbX={-6.35} pcbY={19.05} pcbRotation={270} />
    <pinheader name="J2" pinCount={2} pitch="2.54mm" pcbX={3.81} pcbY={-15.24} pcbRotation={270} />
    <connector name="J3" footprint="screw2" pinLabels={{ pin1: "COIL_P", pin2: "COIL_N" }} pcbX={-19.05} pcbY={19.05} pcbRotation={270} />
    <transistor name="Q1" footprint="to92" pcbX={-1.27} pcbY={1.27} pcbRotation={90} />
    <resistor name="R1" resistance="4.7k" footprint="axial6.3x10.16" pcbX={16.51} pcbY={-6.35} pcbRotation={270} />
    <resistor name="R2" resistance="10k" footprint="axial6.3x10.16" pcbX={-1.27} pcbY={-8.89} pcbRotation={270} />
    <resistor name="R3" resistance="10k" footprint="axial6.3x10.16" pcbX={13.97} pcbY={11.43} pcbRotation={270} />
    <diode name="D1" footprint="axial4x10.16" pcbX={6.35} pcbY={6.35} pcbRotation={90} />
    <led name="D2" footprint="led5mm" pcbX={11.43} pcbY={0} pcbRotation={270} />
    <trace from="J1.pin1" to="net.V24" />
    <trace from="J3.pin1" to="net.V24" />
    <trace from="D1.pin2" to="net.V24" />
    <trace from="R3.pin1" to="net.V24" />
    <trace from="J1.pin2" to="net.GND" />
    <trace from="J2.pin2" to="net.GND" />
    <trace from="Q1.pin1" to="net.GND" />
    <trace from="R2.pin2" to="net.GND" />
    <trace from="J2.pin1" to="net.CTRL" />
    <trace from="R1.pin1" to="net.CTRL" />
    <trace from="R1.pin2" to="net.BASE" />
    <trace from="R2.pin1" to="net.BASE" />
    <trace from="Q1.pin2" to="net.BASE" />
    <trace from="Q1.pin3" to="net.DRV" />
    <trace from="J3.pin2" to="net.DRV" />
    <trace from="D1.pin1" to="net.DRV" />
    <trace from="D2.pin2" to="net.DRV" />
    <trace from="R3.pin2" to="net.LEDA" />
    <trace from="D2.pin1" to="net.LEDA" />
  </board>
)
