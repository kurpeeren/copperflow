import { LM2596S_ADJ } from "./parts/LM2596S-ADJ/LM2596S_ADJ"
export default () => (
  <board width="43mm" height="21mm">
    <LM2596S_ADJ name="U1" schX={-1} schY={0.8} schNameAt={{ x: -0.55, y: 0.45 }} />
    <capacitor name="C1" polarized={true} voltageRating="50V" capacitance="100uF" footprint="smdcan8x10.2" schX={-3.3} schY={-0.4} />
    <capacitor name="C2" polarized={true} voltageRating="35V" capacitance="220uF" footprint="smdcan8x10.2" schX={4} schY={-0.4} />
    <inductor name="L1" inductance="68uH" footprint="ind12x12" schX={2.4} schY={0.8} />
    <diode name="D1" mpn="SS34" footprint="sma" schX={1.3} schY={-0.4} />
    <potentiometer name="RV1" maxResistance="10k" footprint="trimmer3296w" schX={2.6} schY={-1.7} schNameAt={{ x: -0.4, y: 0.3 }} />
    <resistor name="R1" resistance="330" footprint="0805" schX={0.6} schY={-2.2} />
    <resistor name="R2" resistance="4.7k" footprint="1206" pcbNameRotation={90} schX={4} schY={-2.6} />
    <led name="D2" color="red" footprint="0805" schX={5.4} schY={-2.6} />
    <pinheader name="J1" pinCount={1} pitch="2.54mm" footprint="wirepad2_d1" pinLabels={{ pin1: "IN_P" }} schX={-5.5} schY={0.8} pcbNameHidden={true} />
    <pinheader name="J2" pinCount={1} pitch="2.54mm" footprint="wirepad2_d1" pinLabels={{ pin1: "IN_N" }} schX={-5.5} schY={-1.8} pcbNameHidden={true} />
    <pinheader name="J3" pinCount={1} pitch="2.54mm" footprint="wirepad2_d1" pinLabels={{ pin1: "OUT_P" }} schX={6.3} schY={0.8} pcbNameHidden={true} />
    <pinheader name="J4" pinCount={1} pitch="2.54mm" footprint="wirepad2_d1" pinLabels={{ pin1: "OUT_N" }} schX={6.3} schY={-1.8} pcbNameHidden={true} />
    <hole x={-15.6} y={-5.4} diameter={3} />
    <hole x={15.6} y={-7.9} diameter={3} />
    <copperpour net="GND" layer="top" />
    <copperpour net="GND" layer="bottom" />
    <silkscreentext text="IN+" x={-20.5} y={5.2} layer="top" height={1} rotation={90} />
    <silkscreentext text="IN-" x={-20.5} y={-5.2} layer="top" height={1} rotation={90} />
    <silkscreentext text="OUT+" x={19.3} y={5.9} layer="top" height={1} />
    <silkscreentext text="OUT-" x={19.3} y={-5.9} layer="top" height={1} />
    <silkscreentext text="LM2596 BUCK" x={2} y={-4.6} layer="bottom" height={1.2} />
    <silkscreentext text="OUT 1.25-30V 3A" x={2} y={-7.2} layer="bottom" height={1} />
    <trace from="J1.pin1" to="net.VIN" />
    <trace from="U1.VIN" to="net.VIN" />
    <trace from="C1.pin1" to="net.VIN" />
    <trace from="J2.pin1" to="net.GND" />
    <trace from="J4.pin1" to="net.GND" />
    <trace from="U1.pin3" to="net.GND" />
    <trace from="U1.pin6" to="net.GND" />
    <trace from="U1.ON_OFF" to="net.GND" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="C2.pin2" to="net.GND" />
    <trace from="D1.anode" to="net.GND" />
    <trace from="R1.pin2" to="net.GND" />
    <trace from="D2.cathode" to="net.GND" />
    <trace from="U1.OUTPUT" to="net.SW" />
    <trace from="D1.cathode" to="net.SW" />
    <trace from="L1.pin1" to="net.SW" />
    <trace from="L1.pin2" to="net.VOUT" />
    <trace from="C2.pin1" to="net.VOUT" />
    <trace from="J3.pin1" to="net.VOUT" />
    <trace from="RV1.pin1" to="net.VOUT" />
    <trace from="R2.pin1" to="net.VOUT" />
    <trace from="U1.FEEDBACK" to="net.FB" />
    <trace from="RV1.pin2" to="net.FB" />
    <trace from="RV1.pin3" to="net.FB" />
    <trace from="R1.pin1" to="net.FB" />
    <trace from="R2.pin2" to="net.LED" />
    <trace from="D2.anode" to="net.LED" />
  </board>
)
