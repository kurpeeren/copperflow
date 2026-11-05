// USB-C input regulated down to 3.3 V, with a power LED and a 2-pin output header.
// Objects such as pinLabels are expressions, so copperflow shows them as read-only.
import { AP2112K_3_3 } from "./parts/AP2112K-3.3/AP2112K_3_3"
import { TYPE_C_6P } from "./parts/TYPE-C-6P/TYPE_C_6P"

export default () => (
  <board width="30mm" height="18mm" schMaxTraceDistance={0.5}>
    {/* Power-only USB-C receptacle from the parts library (parts/TYPE-C-6P), mating face toward the left edge */}
    <TYPE_C_6P name="J1" schX={0} schY={0} pcbX={-9.8} pcbY={0} pcbRotation={-90} />
    {/* 5.1k pull-downs on CC tell a USB-C source to supply 5 V */}
    <resistor name="R1" resistance="5.1k" footprint="0402" schX={3.5} schY={-2.5} schRotation={-90} pcbX={-4.5} pcbY={4} />
    <resistor name="R2" resistance="5.1k" footprint="0402" schX={5} schY={-2.5} schRotation={-90} pcbX={-4.5} pcbY={-4} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" schX={3} schY={1.2} schRotation={-90} pcbX={-1.5} pcbY={0} />

    {/* AP2112K-3.3 low-dropout regulator from the parts library (parts/AP2112K-3.3) */}
    <AP2112K_3_3 name="U1" schX={9} schY={0} pcbX={2.5} pcbY={0} />
    <capacitor name="C2" capacitance="1uF" footprint="0603" schX={12} schY={0} schRotation={-90} pcbX={6.5} pcbY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={14} schY={0.8} schRotation={-90} pcbX={6.5} pcbY={5} />
    {/* The JLCPCB LED has its cathode on pad 1 */}
    <led
      name="LED1"
      color="red"
      footprint="0603"
      pinLabels={{ pin1: "cathode", pin2: "anode" }}
      schX={14}
      schY={-1.2}
      schRotation={-90}
      pcbX={10}
      pcbY={5}
    />
    <pinheader name="J2" pinCount={2} pitch="2.54mm" gender="male" schX={16.5} schY={0} pcbX={11.5} pcbY={-5} />

    {/* 0.4 mm power traces: the regulator can deliver up to 600 mA */}
    <trace from="J1.VBUS1" to="net.VBUS" thickness="0.4mm" />
    <trace from="J1.VBUS2" to="net.VBUS" thickness="0.4mm" />
    <trace from="J1.GND1" to="net.GND" thickness="0.4mm" />
    <trace from="J1.GND2" to="net.GND" thickness="0.4mm" />
    <trace from="J1.EH" to="net.GND" thickness="0.4mm" />
    <trace from="J1.CC1" to="net.CC1" />
    <trace from="R1.pin1" to="net.CC1" />
    <trace from="R1.pin2" to="net.GND" />
    <trace from="J1.CC2" to="net.CC2" />
    <trace from="R2.pin1" to="net.CC2" />
    <trace from="R2.pin2" to="net.GND" />
    <trace from="C1.pin1" to="net.VBUS" thickness="0.4mm" />
    <trace from="C1.pin2" to="net.GND" thickness="0.4mm" />
    <trace from="U1.VIN" to="net.VBUS" thickness="0.4mm" />
    {/* EN must not float, or the regulator stays off */}
    <trace from="U1.EN" to="net.VBUS" thickness="0.4mm" />
    <trace from="U1.GND" to="net.GND" thickness="0.4mm" />
    <trace from="U1.VOUT" to="net.V3_3" thickness="0.4mm" />
    <trace from="C2.pin1" to="net.V3_3" thickness="0.4mm" />
    <trace from="C2.pin2" to="net.GND" thickness="0.4mm" />
    <trace from="R3.pin1" to="net.V3_3" />
    <trace from="R3.pin2" to="net.LED_A" />
    <trace from="LED1.anode" to="net.LED_A" />
    <trace from="LED1.cathode" to="net.GND" />
    <trace from="J2.pin1" to="net.V3_3" thickness="0.4mm" />
    <trace from="J2.pin2" to="net.GND" thickness="0.4mm" />
  </board>
)
