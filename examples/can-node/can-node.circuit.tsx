import CanNode from "./CanNode.sheet"
export default () => (
  <board width={28.2} height={26.8} pcbX={-3.7} pcbY={-19}>
    <pinheader name="J1" pinCount={7} pitch="2.54mm" pinLabels={{ pin1: "V5", pin2: "V3V3", pin3: "GND", pin4: "SCK", pin5: "MOSI", pin6: "MISO", pin7: "CS" }} pcbX={-6} pcbY={-8.2} pcbRotation={0} />
    <pinheader name="J2" pinCount={1} pitch="2.54mm" pinLabels={{ pin1: "INT" }} pcbX={4.5} pcbY={-8.2} pcbRotation={0} />
    <pinheader name="J3" pinCount={3} pitch="2.54mm" pinLabels={{ pin1: "CANH", pin2: "CANL", pin3: "GND" }} pcbX={-10} pcbY={-29.8} pcbRotation={0} />
    <pinheader name="JP1" pinCount={2} pitch="2.54mm" pinLabels={{ pin1: "TERM", pin2: "CANL" }} pcbX={-1.5} pcbY={-29.8} pcbRotation={0} />
    <CanNode name="CAN1" connections={{ V5: "V5", V3V3: "V3V3", GND: "GND", SCK: "SCK", MOSI: "MOSI", MISO: "MISO", CS: "CS", INT: "INT", CANH: "CANH", CANL: "CANL", TERM: "TERM" }} base={100} pcbX={-2.5} pcbY={-19.5} pcbRotation={180} />
    <copperpour net="GND" layer="top" />
    <copperpour net="GND" layer="bottom" />
    <trace from="J1.pin1" to="net.V5" />
    <trace from="J1.pin2" to="net.V3V3" />
    <trace from="J1.pin3" to="net.GND" />
    <trace from="J3.pin3" to="net.GND" />
    <trace from="J1.pin4" to="net.SCK" />
    <trace from="J1.pin5" to="net.MOSI" />
    <trace from="J1.pin6" to="net.MISO" />
    <trace from="J1.pin7" to="net.CS" />
    <trace from="J2.pin1" to="net.INT" />
    <trace from="J3.pin1" to="net.CANH" />
    <trace from="J3.pin2" to="net.CANL" />
    <trace from="JP1.pin2" to="net.CANL" />
    <trace from="JP1.pin1" to="net.TERM" />
  </board>
)
