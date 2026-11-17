import DigitalInput24V from "./DigitalInput24V.sheet"
export default () => (
  <board width={43.4} height={24.2} pcbX={0.9} pcbY={-1}>
    <pinheader name="J1" pinCount={10} pitch="2.54mm" footprint="pinrow10" pinLabels={{ pin1: "IN1", pin2: "IN2", pin3: "IN3", pin4: "IN4", pin5: "IN5", pin6: "IN6", pin7: "IN7", pin8: "IN8", pin9: "V24", pin10: "GND" }} pcbX={-0.6} pcbY={-10.5} pcbRotation={0} noConnect="pin9" />
    <pinheader name="J2" pinCount={10} pitch="2.54mm" noConnect="pin10" footprint="pinrow10" pinLabels={{ pin1: "DI1", pin2: "DI2", pin3: "DI3", pin4: "DI4", pin5: "DI5", pin6: "DI6", pin7: "DI7", pin8: "DI8", pin9: "GND", pin10: "NC" }} pcbX={-0.6} pcbY={8.5} pcbRotation={0} />
    <DigitalInput24V name="CH1" connections={{ IN: "IN1", OUT: "DI1", GND: "GND" }} base={100} pcbX={-18.2} pcbY={3.5} pcbRotation={270} />
    <DigitalInput24V name="CH2" connections={{ IN: "IN2", OUT: "DI2", GND: "GND" }} base={200} pcbX={-13} pcbY={3.5} pcbRotation={270} />
    <DigitalInput24V name="CH3" connections={{ IN: "IN3", OUT: "DI3", GND: "GND" }} base={300} pcbX={-7.8} pcbY={3.5} pcbRotation={270} />
    <DigitalInput24V name="CH4" connections={{ IN: "IN4", OUT: "DI4", GND: "GND" }} base={400} pcbX={-2.6} pcbY={3.5} pcbRotation={270} />
    <DigitalInput24V name="CH5" connections={{ IN: "IN5", OUT: "DI5", GND: "GND" }} base={500} pcbX={2.6} pcbY={3.5} pcbRotation={270} />
    <DigitalInput24V name="CH6" connections={{ IN: "IN6", OUT: "DI6", GND: "GND" }} base={600} pcbX={7.8} pcbY={3.5} pcbRotation={270} />
    <DigitalInput24V name="CH7" connections={{ IN: "IN7", OUT: "DI7", GND: "GND" }} base={700} pcbX={13} pcbY={3.5} pcbRotation={270} />
    <DigitalInput24V name="CH8" connections={{ IN: "IN8", OUT: "DI8", GND: "GND" }} base={800} pcbX={18.2} pcbY={3.5} pcbRotation={270} />
    <copperpour net="GND" layer="bottom" />
    <copperpour net="GND" layer="top" />
    <trace from="J1.pin1" to="net.IN1" />
    <trace from="J1.pin2" to="net.IN2" />
    <trace from="J1.pin3" to="net.IN3" />
    <trace from="J1.pin4" to="net.IN4" />
    <trace from="J1.pin5" to="net.IN5" />
    <trace from="J1.pin6" to="net.IN6" />
    <trace from="J1.pin7" to="net.IN7" />
    <trace from="J1.pin8" to="net.IN8" />
    <trace from="J2.pin1" to="net.DI1" />
    <trace from="J2.pin2" to="net.DI2" />
    <trace from="J2.pin3" to="net.DI3" />
    <trace from="J2.pin4" to="net.DI4" />
    <trace from="J2.pin5" to="net.DI5" />
    <trace from="J2.pin6" to="net.DI6" />
    <trace from="J2.pin7" to="net.DI7" />
    <trace from="J2.pin8" to="net.DI8" />
    <trace from="J1.pin10" to="net.GND" />
    <trace from="J2.pin9" to="net.GND" />
  </board>
)
