import { TYPE_C_16P } from "./parts/TYPE-C-16P/TYPE_C_16P"
import { AP2112K_3_3 } from "./parts/AP2112K-3.3/AP2112K_3_3"
export default () => (
  <board width="34mm" height="22mm">
    <TYPE_C_16P name="J1" noConnect="SBU1,SBU2,DP1,DN1,DP2,DN2" pcbX={-12.35} pcbY={-0.5} pcbRotation={270} />
    <resistor name="R1" resistance="5.1k" footprint="0402" pcbX={-4.5} pcbY={0.5} pcbRotation={270} />
    <resistor name="R2" resistance="5.1k" footprint="0402" pcbX={-5.81} pcbY={3.1} pcbRotation={0} />
    <diode name="D1" footprint="sod123" pcbX={-4.15} pcbY={-5.45} pcbRotation={0} />
    <capacitor name="C3" capacitance="10uF" footprint="0805" pcbX={-3.75} pcbY={-2.15} pcbRotation={180} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={-0.3} pcbY={-3.1} pcbRotation={0} />
    <AP2112K_3_3 name="U1" pcbX={0} pcbY={0} pcbRotation={0} />
    <capacitor name="C2" capacitance="1uF" footprint="0603" pcbX={-2.8} pcbY={0.6} pcbRotation={270} />
    <resistor name="R3" resistance="1k" footprint="0402" pcbX={-0.95} pcbY={3.25} pcbRotation={90} />
    <led name="LED1" color="green" footprint="0603" pcbX={-3.16} pcbY={3.1} pcbRotation={180} />
    <pinheader name="J2" pinCount={2} pcbX={-7} pcbY={-9.7} pcbRotation={180} />
    <pinheader name="J3" pinCount={3} pcbX={2} pcbY={-9.7} pcbRotation={0} />
    <hole x={-14} y={8} diameter={3.2} />
    <hole x={14} y={8} diameter={3.2} />
    <hole x={-14} y={-8} diameter={3.2} />
    <hole x={14} y={-8} diameter={3.2} />
    <copperpour net="GND" layer="bottom" />
    <silkscreentext text="USB-C 3V3" x={5.5} y={7.5} layer="top" height={1.5} />
    <silkscreentext text="5V 3V3 GND" x={2} y={-6.6} layer="top" height={0.9} />
    <boardgraphic file="graphics/bolt.svg" layer="top-silkscreen" x={9} y={1.5} width={4} />
    <copperpour net="GND" layer="top" />
    <trace from="J1.VBUS1" to="net.VBUS" />
    <trace from="J1.VBUS2" to="net.VBUS" />
    <trace from="D1.pin1" to="net.VBUS" />
    <trace from="J1.CC1" to="net.CC1" />
    <trace from="R1.pin1" to="net.CC1" />
    <trace from="J1.CC2" to="net.CC2" />
    <trace from="R2.pin1" to="net.CC2" />
    <trace from="D1.pin2" to="net.V5" />
    <trace from="C3.pin1" to="net.V5" />
    <trace from="C1.pin1" to="net.V5" />
    <trace from="U1.VIN" to="net.V5" />
    <trace from="U1.EN" to="net.V5" />
    <trace from="J3.pin1" to="net.V5" />
    <trace from="U1.VOUT" to="net.V3_3" />
    <trace from="C2.pin1" to="net.V3_3" />
    <trace from="R3.pin1" to="net.V3_3" />
    <trace from="J2.pin1" to="net.V3_3" />
    <trace from="J3.pin2" to="net.V3_3" />
    <trace from="R3.pin2" to="net.LED_A" />
    <trace from="LED1.pin1" to="net.LED_A" />
    <trace from="J1.GND1" to="net.GND" />
    <trace from="J1.GND2" to="net.GND" />
    <trace from="J1.SHIELD" to="net.GND" />
    <trace from="R1.pin2" to="net.GND" />
    <trace from="R2.pin2" to="net.GND" />
    <trace from="C3.pin2" to="net.GND" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="U1.GND" to="net.GND" />
    <trace from="C2.pin2" to="net.GND" />
    <trace from="LED1.pin2" to="net.GND" />
    <trace from="J2.pin2" to="net.GND" />
    <trace from="J3.pin3" to="net.GND" />
  </board>
)
