export default () => (
  <board width="20mm" height="12mm">
    <chip name="U1" footprint="sot223" pinLabels={{ pin1: "GND", pin2: "VOUT", pin3: "VIN", pin4: "TAB" }} pcbX={2.5} pcbY={-1.5} pcbRotation={270} />
    <capacitor name="C1" capacitance="10uF" voltageRating="25V" footprint="1206" pcbX={-3.15} pcbY={-1.5} pcbRotation={90} />
    <capacitor name="C2" capacitance="22uF" voltageRating="10V" footprint="1206" pcbX={-4.5} pcbY={2.5} pcbRotation={180} />
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-3.5} pcbY={-5} pcbRotation={180} />
    <led name="D1" color="green" footprint="0603" pcbX={-5.3} pcbY={-0.8} pcbRotation={90} />
    <pinheader name="J1" pinCount={1} footprint="wirepad2_d1" pcbEdge="left" pcbNameText="VIN" pcbX={-8.55} pcbY={-3.5} pcbRotation={0} />
    <pinheader name="J2" pinCount={1} footprint="wirepad2_d1" pcbEdge="left" pcbNameText="GND" pcbX={-8.55} pcbY={-0.5} pcbRotation={0} />
    <pinheader name="J3" pinCount={1} footprint="wirepad2_d1" pcbEdge="right" pcbNameText="5V" pcbX={8.55} pcbY={-1} pcbRotation={0} />
    <pinheader name="J4" pinCount={1} footprint="wirepad2_d1" pcbEdge="right" pcbNameText="GND" pcbX={8.55} pcbY={2} pcbRotation={0} />
    <copperpour net="GND" layer="bottom" />
    <copperpour net="GND" layer="top" />
    <trace from="J1.pin1" to="net.VIN" />
    <trace from="U1.VIN" to="net.VIN" />
    <trace from="C1.pin1" to="net.VIN" />
    <trace from="J3.pin1" to="net.VOUT" />
    <trace from="U1.VOUT" to="net.VOUT" />
    <trace from="U1.TAB" to="net.VOUT" />
    <trace from="C2.pin1" to="net.VOUT" />
    <trace from="R1.pin1" to="net.VOUT" />
    <trace from="R1.pin2" to="net.LED" />
    <trace from="D1.anode" to="net.LED" />
    <trace from="J2.pin1" to="net.GND" />
    <trace from="J4.pin1" to="net.GND" />
    <trace from="U1.GND" to="net.GND" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="C2.pin2" to="net.GND" />
    <trace from="D1.cathode" to="net.GND" />
  </board>
)
