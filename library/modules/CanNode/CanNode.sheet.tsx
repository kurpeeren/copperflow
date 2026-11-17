import { MCP2515_I_SO } from "./parts/MCP2515-I-SO/MCP2515_I_SO"
import { TJA1051T_3 } from "./parts/TJA1051T-3/TJA1051T_3"
export default function CanNode() {
  return (
    <sheet does="CAN node: MCP2515 on 3.3 V, 8 MHz crystal (CL 18 pF, 27 pF caps), TJA1051T/3 with VIO 3.3 V and VCC 5 V, 120 ohm termination to the TERM port" sources={["https://ww1.microchip.com/downloads/en/DeviceDoc/MCP2515-Stand-Alone-CAN-Controller-with-SPI-20001801J.pdf (p1 pinout, p4 Table 1-1)","https://www.nxp.com/docs/en/data-sheet/TJA1051.pdf (p4 Table 3; S low selects Normal mode, p5)","https://abracon.com/Resonators/abl.pdf (ABL HC49/US: CL 18 pF, C0 7 pF max, p1)"]} cases={[{ name: "termination: 1 V across CANH and TERM", set: { V5: 5, V3V3: 3.3, GND: 0, CANH: 1, TERM: 0 }, expect: { "R2.i": [0.0083, 0.00837] } }, { name: "supplies reach the pins", set: { V5: 5, V3V3: 3.3, GND: 0 }, expect: { RESET: [3.29, 3.31], V3V3: [3.29, 3.31], V5: [4.99, 5.01] } }]}>
      <port name="V5" type="power_in" carries="5 V in, 70 mA at most (transceiver, bus dominant)" />
      <port name="V3V3" type="power_in" carries="3.3 V in, 10 mA (controller 5 mA typ, VIO)" />
      <port name="GND" type="ground" carries="logic and bus ground" />
      <port name="SCK" type="input" carries="SPI clock from the host, 3.3 V logic, 10 MHz at most" />
      <port name="MOSI" type="input" carries="SPI data from the host, 3.3 V logic" />
      <port name="MISO" type="output" carries="SPI data to the host, 3.3 V logic" />
      <port name="CS" type="input" carries="SPI chip select, active low, 3.3 V logic" />
      <port name="INT" type="output" carries="interrupt to the host, active low, 3.3 V logic" />
      <port name="CANH" type="bidirectional" carries="CAN high line, up to 1 Mbit/s" />
      <port name="CANL" type="bidirectional" carries="CAN low line" />
      <port name="TERM" type="passive" carries="far end of the 120 ohm from CANH; join to CANL to terminate" />
      <MCP2515_I_SO name="U1" noConnect="pin3,pin4,pin5,pin6,pin10,pin11" pcbX={0} pcbY={0} pcbRotation={0} />
      <TJA1051T_3 name="U2" pcbX={11} pcbY={1} pcbRotation={270} />
      <crystal name="Y1" manufacturerPartNumber="ABL-8.000MHZ-B2" frequency="8MHz" footprint="hc49" pcbX={-8.8} pcbY={-3.175} pcbRotation={90} />
      <capacitor name="C1" capacitance="27pF" footprint="0603" pcbX={-4.45} pcbY={-7.15} pcbRotation={0} />
      <capacitor name="C2" capacitance="27pF" footprint="0603" pcbX={-7.7} pcbY={3.63} pcbRotation={0} />
      <capacitor name="C3" capacitance="100nF" footprint="0603" pcbX={7} pcbY={3.5} pcbRotation={270} />
      <capacitor name="C4" capacitance="100nF" footprint="0603" pcbX={11} pcbY={5.7} pcbRotation={0} />
      <capacitor name="C5" capacitance="100nF" footprint="0603" pcbX={7.25} pcbY={-1.2} pcbRotation={90} />
      <resistor name="R1" resistance="10k" footprint="0603" pcbX={7.75} pcbY={6} pcbRotation={180} />
      <resistor name="R2" resistance="120" footprint="0805" pcbX={11.635} pcbY={-4.65} pcbRotation={270} />
      <trace from="U1.VDD" to="net.V3V3" />
      <trace from="C3.pin1" to="net.V3V3" />
      <trace from="U2.VIO" to="net.V3V3" />
      <trace from="C5.pin1" to="net.V3V3" />
      <trace from="R1.pin1" to="net.V3V3" />
      <trace from="U2.VCC" to="net.V5" />
      <trace from="C4.pin1" to="net.V5" />
      <trace from="U1.VSS" to="net.GND" />
      <trace from="U2.GND" to="net.GND" />
      <trace from="U2.S" to="net.GND" />
      <trace from="C1.pin2" to="net.GND" />
      <trace from="C2.pin2" to="net.GND" />
      <trace from="C3.pin2" to="net.GND" />
      <trace from="C4.pin2" to="net.GND" />
      <trace from="C5.pin2" to="net.GND" />
      <trace from="U1.SCK" to="net.SCK" />
      <trace from="U1.SI" to="net.MOSI" />
      <trace from="U1.SO" to="net.MISO" />
      <trace from="U1.CS" to="net.CS" />
      <trace from="U1.INT" to="net.INT" />
      <trace from="U1.RESET" to="net.RESET" />
      <trace from="R1.pin2" to="net.RESET" />
      <trace from="U1.OSC1" to="net.OSC1" />
      <trace from="Y1.pin1" to="net.OSC1" />
      <trace from="C1.pin1" to="net.OSC1" />
      <trace from="U1.OSC2" to="net.OSC2" />
      <trace from="Y1.pin2" to="net.OSC2" />
      <trace from="C2.pin1" to="net.OSC2" />
      <trace from="U1.TXCAN" to="net.TXCAN" />
      <trace from="U2.TXD" to="net.TXCAN" />
      <trace from="U1.RXCAN" to="net.RXCAN" />
      <trace from="U2.RXD" to="net.RXCAN" />
      <trace from="U2.CANH" to="net.CANH" />
      <trace from="R2.pin1" to="net.CANH" />
      <trace from="U2.CANL" to="net.CANL" />
      <trace from="R2.pin2" to="net.TERM" />
    </sheet>
  )
}
