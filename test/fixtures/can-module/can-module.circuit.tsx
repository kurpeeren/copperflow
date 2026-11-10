import { MCP2515 } from "./parts/MCP2515/MCP2515"
import { TJA1050 } from "./parts/TJA1050/TJA1050"
export default () => (
  <board width="42mm" height="28mm">
    <MCP2515 name="U1" pcbX={-7} pcbY={2} pcbRotation={0} schX={6.5} schY={0} schRotation={0} />
    <TJA1050 name="U2" pcbX={8} pcbY={2} pcbRotation={0} schX={13.5} schY={0.2} schRotation={0} />
    <crystal name="Y1" frequency="8MHz" footprint="pinrow2_p4.88mm" pcbX={-7} pcbY={-9} pcbRotation={0} schX={6.5} schY={-4.2} schRotation={0} />
    <capacitor name="C1" capacitance="22pF" footprint="0805" pcbX={-12.5} pcbY={-6} pcbRotation={90} schX={4.6} schY={-5.6} schRotation={-90} />
    <capacitor name="C2" capacitance="22pF" footprint="0805" pcbX={-1.5} pcbY={-6} pcbRotation={90} schX={8.4} schY={-5.6} schRotation={-90} />
    <capacitor name="C3" capacitance="100nF" footprint="0805" pcbX={-1} pcbY={10.5} pcbRotation={0} schX={3.6} schY={3.2} schRotation={-90} />
    <capacitor name="C4" capacitance="100nF" footprint="0805" pcbX={8} pcbY={8} pcbRotation={0} schX={13.5} schY={3.4} schRotation={-90} />
    <resistor name="R1" resistance="10k" footprint="0805" pcbX={2.5} pcbY={7} pcbRotation={90} schX={10.2} schY={2.6} schRotation={-90} />
    <resistor name="R2" resistance="120" footprint="0805" pcbX={8} pcbY={-9} pcbRotation={0} schX={16.6} schY={-2.4} schRotation={-90} />
    <pinheader name="J1" pinCount={7} pitch="2.54mm" gender="male" pinLabels={{ pin1: "INT", pin2: "SCK", pin3: "SI", pin4: "SO", pin5: "CS", pin6: "GND", pin7: "VCC" }} pcbX={-18.5} pcbY={0} pcbRotation={90} schX={0} schY={0} schRotation={0} />
    <pinheader name="J2" pinCount={2} pitch="5.08mm" gender="male" pinLabels={{ pin1: "CANH", pin2: "CANL" }} pcbX={17.5} pcbY={2} pcbRotation={90} schX={18.5} schY={0.4} schRotation={0} />
    <pinheader name="J3" pinCount={2} pitch="2.54mm" gender="male" pcbX={14} pcbY={-9} pcbRotation={0} schX={18.5} schY={-3.2} schRotation={0} />
    <trace from="J1.VCC" to="net.VCC" />
    <trace from="U1.VDD" to="net.VCC" />
    <trace from="U2.VCC" to="net.VCC" />
    <trace from="C3.pin1" to="net.VCC" />
    <trace from="C4.pin1" to="net.VCC" />
    <trace from="R1.pin1" to="net.VCC" />
    <trace from="J1.GND" to="net.GND" />
    <trace from="U1.VSS" to="net.GND" />
    <trace from="U2.GND" to="net.GND" />
    <trace from="U2.S" to="net.GND" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="C2.pin2" to="net.GND" />
    <trace from="C3.pin2" to="net.GND" />
    <trace from="C4.pin2" to="net.GND" />
    <trace from="U1.TXCAN" to="net.TXCAN" />
    <trace from="U2.TXD" to="net.TXCAN" />
    <trace from="U1.RXCAN" to="net.RXCAN" />
    <trace from="U2.RXD" to="net.RXCAN" />
    <trace from="U1.OSC1" to="net.OSC1" />
    <trace from="Y1.pin1" to="net.OSC1" />
    <trace from="C1.pin1" to="net.OSC1" />
    <trace from="U1.OSC2" to="net.OSC2" />
    <trace from="Y1.pin2" to="net.OSC2" />
    <trace from="C2.pin1" to="net.OSC2" />
    <trace from="U1.RESET" to="net.RESET" />
    <trace from="R1.pin2" to="net.RESET" />
    <trace from="J1.INT" to="net.INT" />
    <trace from="U1.INT" to="net.INT" />
    <trace from="J1.SCK" to="net.SCK" />
    <trace from="U1.SCK" to="net.SCK" />
    <trace from="J1.SI" to="net.SI" />
    <trace from="U1.SI" to="net.SI" />
    <trace from="J1.SO" to="net.SO" />
    <trace from="U1.SO" to="net.SO" />
    <trace from="J1.CS" to="net.CS" />
    <trace from="U1.CS" to="net.CS" />
    <trace from="U2.CANH" to="net.CANH" />
    <trace from="J2.CANH" to="net.CANH" />
    <trace from="J3.pin1" to="net.CANH" />
    <trace from="U2.CANL" to="net.CANL" />
    <trace from="J2.CANL" to="net.CANL" />
    <trace from="R2.pin2" to="net.CANL" />
    <trace from="J3.pin2" to="net.TERM" />
    <trace from="R2.pin1" to="net.TERM" />
    <trace from="U1.TX0RTS" to="net.VCC" />
    <trace from="U1.TX1RTS" to="net.VCC" />
    <trace from="U1.TX2RTS" to="net.VCC" />
  </board>
)
