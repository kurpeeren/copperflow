import RelayDriver from "./RelayDriver.sheet"
export default () => (
  <board width={33.6} height={26.6} pcbY={1.5}>
    <pinheader name="J1" pinCount={2} pitch="2.54mm" pinLabels={{ pin1: "V12", pin2: "GND" }} pcbX={13.7} pcbY={-0.5} pcbRotation={90} />
    <pinheader name="J2" pinCount={2} pitch="2.54mm" pinLabels={{ pin1: "CTRL", pin2: "GND" }} pcbX={12} pcbY={8.7} pcbRotation={0} />
    <pinheader name="J3" pinCount={3} pitch="5.08mm" footprint="pinrow3_p5.08mm" pinLabels={{ pin1: "NC", pin2: "COM", pin3: "NO" }} pcbX={-1.5} pcbY={-8.7} pcbRotation={0} />
    <RelayDriver name="RL1" connections={{ V12: "V12", GND: "GND", CTRL: "CTRL", COM: "COM", NO: "NO", NC: "NC" }} base={100} pcbX={-5} pcbY={3} pcbRotation={180} />
    <copperpour net="GND" layer="bottom" />
    <trace from="J1.pin1" to="net.V12" />
    <trace from="J1.pin2" to="net.GND" />
    <trace from="J2.pin2" to="net.GND" />
    <trace from="J2.pin1" to="net.CTRL" />
    <trace from="J3.pin1" to="net.NC" />
    <trace from="J3.pin2" to="net.COM" />
    <trace from="J3.pin3" to="net.NO" />
  </board>
)
