import { SRD_12VDC_SL_C } from "./parts/SRD-12VDC-SL-C/SRD_12VDC_SL_C"
import { AO3400A } from "./parts/AO3400A/AO3400A"
export default function RelayDriver() {
  return (
    <sheet does="12 V SPDT relay switched by 3.3 V or 5 V logic: AO3400A low side (RDS(on) spec at 2.5 V), 1N4148W flyback, 100k pull-down, LED on while driven" sources={["https://www.circuitbasics.com/wp-content/uploads/2015/11/SRD-05VDC-SL-C-Datasheet.pdf (Songle SRD: p1 drilling and wiring, p2 coil 12 V 400 ohm 30 mA, contacts)","https://www.aosmd.com/res/datasheets/AO3400A.pdf (p2: VGS(th) 1.45 V max, RDS(on) < 48 mOhm at VGS 2.5 V)","https://www.diodes.com/assets/Datasheets/ds30086.pdf (1N4148W-7-F, SOD123, p1)","https://www.kingbrightusa.com/images/catalog/SPEC/APTD1608LZGCK.pdf (p2: VF 2.65 V typ at 2 mA)"]}>
      <port name="V12" type="power_in" carries="12 V in, 33 mA (coil 30 mA, LED 2 mA)" />
      <port name="GND" type="ground" carries="return of coil and logic, 33 mA" />
      <port name="CTRL" type="input" carries="0 off; 3.3 V or 5 V logic on, 0.03 mA; open is off" />
      <port name="COM" type="passive" carries="contact common, 10 A 250 VAC / 28 VDC resistive at most" />
      <port name="NO" type="passive" carries="normally open contact, closed while CTRL is high, 10 A at most" />
      <port name="NC" type="passive" carries="normally closed contact, open while CTRL is high, 10 A at most" />
      <SRD_12VDC_SL_C name="K1" pcbX={0} pcbY={0} pcbRotation={0} />
      <AO3400A name="Q1" pcbX={-12} pcbY={-5} pcbRotation={0} />
      <diode name="D1" manufacturerPartNumber="1N4148W-7-F" footprint="sod123" pcbX={-11.15} pcbY={0} pcbRotation={90} />
      <resistor name="R1" resistance="100" footprint="0603" pcbX={-12.25} pcbY={-7.85} pcbRotation={180} />
      <resistor name="R2" resistance="100k" footprint="0603" pcbX={-9} pcbY={-9} pcbRotation={0} />
      <resistor name="R3" resistance="4.7k" footprint="0603" pcbX={-7} pcbY={9} pcbRotation={180} />
      <led name="LED1" color="green" manufacturerPartNumber="APTD1608LZGCK" footprint="0603" pcbX={-10.8} pcbY={4.3} pcbRotation={270} />
      <trace from="K1.COIL1" to="net.V12" />
      <trace from="D1.cathode" to="net.V12" />
      <trace from="R3.pin1" to="net.V12" />
      <trace from="K1.COIL2" to="net.DRV" />
      <trace from="D1.anode" to="net.DRV" />
      <trace from="Q1.D" to="net.DRV" />
      <trace from="LED1.cathode" to="net.DRV" />
      <trace from="R3.pin2" to="net.LEDA" />
      <trace from="LED1.anode" to="net.LEDA" />
      <trace from="R1.pin1" to="net.CTRL" />
      <trace from="R1.pin2" to="net.GATE" />
      <trace from="R2.pin1" to="net.GATE" />
      <trace from="Q1.G" to="net.GATE" />
      <trace from="Q1.S" to="net.GND" />
      <trace from="R2.pin2" to="net.GND" />
      <trace from="K1.COM" to="net.COM" />
      <trace from="K1.NO" to="net.NO" />
      <trace from="K1.NC" to="net.NC" />
    </sheet>
  )
}
