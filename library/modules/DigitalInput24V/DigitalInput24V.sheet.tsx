export default function DigitalInput24V() {
  return (
    <sheet does="24 V digital input: 4.53k/1k divider, BZT52C3V6 zener across the 1k, 1k/100nF RC out; low at 5 V, high from 15 V, 3.07 to 3.45 V and 4.6 mA at 24 V" sources={["https://www.diodes.com/assets/Datasheets/ds18004.pdf (BZT52C3V6: 3.4 to 3.8 V at 5 mA, ZZT 90 ohm max, p2; typical curves Fig. 2, p3)","IEC 61131-2 type 1 input: on at 15 to 30 V, off below 5 V","YAGEO RC_L chip resistors: 1206 rated 1/4 W at 70 C (R1 takes 157 mW at 30 V)"]} cases={[{ name: "5 V in reads low", set: { IN: 5, GND: 0 }, expect: { OUT: [0, 0.99] } }, { name: "15 V in reads high", set: { IN: 15, GND: 0 }, expect: { OUT: [2.31, 3.6] } }, { name: "24 V in", set: { IN: 24, GND: 0 }, expect: { OUT: [3, 3.5], "R1.i": [0.0045, 0.0047] } }, { name: "30 V in stays under the pin limit", set: { IN: 30, GND: 0 }, expect: { OUT: [0, 3.6], "R1.p": [0, 0.25] } }]}>
      <port name="IN" type="input" carries="0 to 30 V from the field; 4.6 mA at 24 V, 5.9 mA at 30 V" />
      <port name="OUT" type="output" carries="3.3 V logic: low at 5 V in, high from 15 V, at most 3.53 V; 870 Hz low pass" />
      <port name="GND" type="ground" carries="field and logic ground, 6 mA at most" />
      <resistor name="R1" resistance="4.53k" footprint="1206" pcbX={8.5} pcbY={2.6} pcbRotation={180} />
      <resistor name="R2" resistance="1k" footprint="0603" pcbX={4.5} pcbY={2.1} pcbRotation={180} />
      <diode name="D1" manufacturerPartNumber="BZT52C3V6-7-F" vf="0.9V" vfAt="10mA" vz="3.6V" vzAt="5mA" zz="90" pdmax="370mW" footprint="sod123" pcbX={4.5} pcbY={0} pcbRotation={0} />
      <resistor name="R3" resistance="1k" footprint="0603" pcbX={1.25} pcbY={2.1} pcbRotation={180} />
      <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={0} pcbY={0} pcbRotation={0} />
      <trace from="R1.pin1" to="net.IN" />
      <trace from="R1.pin2" to="net.DIV" />
      <trace from="R2.pin1" to="net.DIV" />
      <trace from="D1.cathode" to="net.DIV" />
      <trace from="R3.pin1" to="net.DIV" />
      <trace from="R3.pin2" to="net.OUT" />
      <trace from="C1.pin1" to="net.OUT" />
      <trace from="R2.pin2" to="net.GND" />
      <trace from="D1.anode" to="net.GND" />
      <trace from="C1.pin2" to="net.GND" />
    </sheet>
  )
}
