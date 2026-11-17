export default function DigitalInput24V() {
  return (
    <sheet does="24 V digital input: 47k/10k divider, BZT52C3V6 3.6 V zener across the 10k, 1k/100nF RC to the output; 3.4 V at 24 V in, 0.43 mA" sources={["https://www.diodes.com/assets/Datasheets/ds18004.pdf (BZT52C3V6: 3.4 to 3.8 V at 5 mA, p2)","IEC 61131-2 type 1 input: on at 15 to 30 V, off below 5 V"]} cases={[{ name: "24 V in", set: { IN: 24, GND: 0 }, expect: { OUT: [3.2, 3.6], "R1.i": [0.0004, 0.00046] } }, { name: "30 V in stays under the pin limit", set: { IN: 30, GND: 0 }, expect: { OUT: [0, 3.6] } }, { name: "5 V in reads low", set: { IN: 5, GND: 0 }, expect: { OUT: [0, 0.99] } }]}>
      <port name="IN" type="input" carries="0 to 30 V from the field; 0.43 mA at 24 V" />
      <port name="OUT" type="output" carries="0 to 3.6 V logic, high above about 13 V in; 170 Hz low pass" />
      <port name="GND" type="ground" carries="field and logic ground, 0.5 mA" />
      <resistor name="R1" resistance="47k" footprint="0603" pcbX={7.75} pcbY={2.1} pcbRotation={180} />
      <resistor name="R2" resistance="10k" footprint="0603" pcbX={4.5} pcbY={2.1} pcbRotation={180} />
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
