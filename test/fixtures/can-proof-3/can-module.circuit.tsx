import { MCP2515 } from "./parts/MCP2515/MCP2515"
import { TJA1051T_3 } from "./parts/TJA1051T-3/TJA1051T_3"
export default () => (
  <board width={30.4} height={23.6} pcbX={-1.6}>
    <MCP2515 name="U1" noConnect="pin3,pin4,pin5,pin6,pin10,pin11" pcbX={0} pcbY={0.5} pcbRotation={0} />
    <TJA1051T_3 name="U2" pcbX={-9} pcbY={1} pcbRotation={270} />
    <crystal name="Y1" frequency="8MHz" footprint="hc49s" pcbX={9} pcbY={-4} pcbRotation={90} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={7} pcbY={4.5} pcbRotation={270} />
    <capacitor name="C2" capacitance="22pF" footprint="0603" pcbX={-9} pcbY={-4.5} pcbRotation={270} />
    <capacitor name="C3" capacitance="22pF" footprint="0603" pcbX={-7} pcbY={-4.45} pcbRotation={90} />
    <capacitor name="C4" capacitance="100nF" footprint="0603" pcbX={-9} pcbY={6} pcbRotation={0} />
    <resistor name="R1" resistance="10k" footprint="0603" pcbX={9.5} pcbY={6} pcbRotation={0} />
    <resistor name="R2" resistance="120" footprint="0603" pcbX={-13} pcbY={-2.5} pcbRotation={90} />
    <resistor name="R3" resistance="330" footprint="0603" pcbX={-10.75} pcbY={-4.5} pcbRotation={270} />
    <led name="D1" color="green" footprint="0603" pcbX={-10} pcbY={-7} pcbRotation={0} />
    <pinheader name="JP1" pinCount={2} pitch="2.54mm" pcbX={-13.7} pcbY={-7} pcbRotation={90} />
    <pinheader name="J1" pinCount={7} pitch="2.54mm" pinLabels={{ pin1: "V5", pin2: "GND", pin3: "CS", pin4: "SO", pin5: "SI", pin6: "SCK", pin7: "INT" }} pcbX={-5} pcbY={8.7} pcbRotation={0} />
    <pinheader name="J2" pinCount={2} pitch="5.08mm" footprint="pinrow2_p5.08mm" pinLabels={{ pin1: "CANH", pin2: "CANL" }} pcbX={-13.7} pcbY={3} pcbRotation={270} />
    <copperpour net="GND" layer="top" />
    <copperpour net="GND" layer="bottom" />
    <trace from="U1.VDD" to="net.V5" />
    <trace from="U2.VCC" to="net.V5" />
    <trace from="U2.VIO" to="net.V5" />
    <trace from="C1.pin1" to="net.V5" />
    <trace from="C4.pin1" to="net.V5" />
    <trace from="R1.pin1" to="net.V5" />
    <trace from="R3.pin1" to="net.V5" />
    <trace from="J1.pin1" to="net.V5" />
    <trace from="U1.VSS" to="net.GND" />
    <trace from="U2.GND" to="net.GND" />
    <trace from="U2.S" to="net.GND" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="C2.pin2" to="net.GND" />
    <trace from="C3.pin2" to="net.GND" />
    <trace from="C4.pin2" to="net.GND" />
    <trace from="D1.cathode" to="net.GND" />
    <trace from="J1.pin2" to="net.GND" />
    <trace from="U1.OSC1" to="net.OSC1" />
    <trace from="Y1.pin1" to="net.OSC1" />
    <trace from="C2.pin1" to="net.OSC1" />
    <trace from="U1.OSC2" to="net.OSC2" />
    <trace from="Y1.pin2" to="net.OSC2" />
    <trace from="C3.pin1" to="net.OSC2" />
    <trace from="U1.RESET" to="net.NRST" />
    <trace from="R1.pin2" to="net.NRST" />
    <trace from="U1.TXCAN" to="net.CAN_TX" />
    <trace from="U2.TXD" to="net.CAN_TX" />
    <trace from="U1.RXCAN" to="net.CAN_RX" />
    <trace from="U2.RXD" to="net.CAN_RX" />
    <trace from="U2.CANH" to="net.CANH" />
    <trace from="J2.pin1" to="net.CANH" />
    <trace from="JP1.pin1" to="net.CANH" />
    <trace from="U2.CANL" to="net.CANL" />
    <trace from="J2.pin2" to="net.CANL" />
    <trace from="R2.pin2" to="net.CANL" />
    <trace from="JP1.pin2" to="net.TERM" />
    <trace from="R2.pin1" to="net.TERM" />
    <trace from="R3.pin2" to="net.LED_A" />
    <trace from="D1.anode" to="net.LED_A" />
    <trace from="U1.CS" to="net.CS" />
    <trace from="J1.pin3" to="net.CS" />
    <trace from="U1.SO" to="net.SO" />
    <trace from="J1.pin4" to="net.SO" />
    <trace from="U1.SI" to="net.SI" />
    <trace from="J1.pin5" to="net.SI" />
    <trace from="U1.SCK" to="net.SCK" />
    <trace from="J1.pin6" to="net.SCK" />
    <trace from="U1.INT" to="net.INT" />
    <trace from="J1.pin7" to="net.INT" />
  </board>
)
