# Worked example: a two-channel sensor board

The brief: "A small board that reads two analog sensors with an ATtiny814, powered from 5 V
through a 3.3 V regulator, with a 4-pin sensor connector and a UPDI header." The calls below are
in order; each shows its arguments and the first lines of its answer. Change ids, counts and
lengths are illustrative: read your own answers.

## 1. Where the project stands

```
project_status {}
→ No PROJECT.md yet: write the Intent and Blocks with set_project.
  Circuits: none yet (new_circuit starts one)
```

## 2. Intent and blocks

```
set_project {
  intent: "Reads two 0-3.3 V analog sensors with an ATtiny814 and reports over UPDI/serial; 5 V in, 3.3 V LDO.",
  blocks: [
    { name: "Power", does: "AP2112K-3.3 LDO, 5 V to 3.3 V", status: "planned" },
    { name: "MCU", does: "ATtiny814 with decoupling", status: "planned" },
    { name: "Channel", does: "1k + 100nF RC filter per sensor input; used twice (CH1, CH2)", status: "planned" },
    { name: "Connectors", does: "J1 sensor header (5V, GND, S1, S2), J2 UPDI header", status: "planned" }
  ],
  open: ["choose parts", "approval before the board", "place, route, export"]
}
→ Change c0001: Intent, Blocks, Open written to PROJECT.md
```

## 3. Parts that are not passives

`list_parts` first; when the regulator and the MCU are not there, write them from their
datasheets with generated footprint strings:

```
list_parts {}
→ The parts library is empty. Create parts with create_part.

create_part { id: "AP2112K-3.3", title: "AP2112K 3.3 V 600 mA LDO", manufacturer: "Diodes Inc.",
  mpn: "AP2112K-3.3TRG1", package: "sot23_5",
  pins: "1 VIN power_in\n2 GND ground\n3 EN input\n4 NC no_connect\n5 VOUT power_out",
  suppliers: { lcsc: "C51118" } }
→ Created AP2112K-3.3: AP2112K 3.3 V 600 mA LDO, 5 pins, footprint sot23_5.
  Wrote parts/AP2112K-3.3/part.yaml, ….
  It is NOT verified: check every pin and the footprint in parts/AP2112K-3.3/verification.md against the datasheet.
  Use it with place_part (part "AP2112K-3.3"). Tell the human it is Unverified until they check verification.md.

create_part { id: "ATTINY814", title: "ATtiny814 8-bit MCU", manufacturer: "Microchip",
  mpn: "ATTINY814-SSN", package: "soic14",
  pins: "1 VCC power_in\n2 PA4 bidirectional\n3 PA5 bidirectional\n4 PA6 bidirectional\n5 PA7 bidirectional\n6 PB3 bidirectional\n7 PB2 bidirectional\n8 PB1 bidirectional\n9 PB0 bidirectional\n10 UPDI bidirectional\n11 PA1 bidirectional\n12 PA2 bidirectional\n13 PA3 bidirectional\n14 GND ground" }
→ Created ATTINY814: ATtiny814 8-bit MCU, 14 pins, footprint soic14. …
```

Only when the human names an LCSC number: `import_part { lcsc: "C51118" }` → `Imported C51118 as
…`; the import is for personal, non-commercial use and is never verified.

## 4. Blocks as sheets, the channel used twice

One call writes the circuit and both sheet files. `place: false`: the board waits for approval.

```
new_circuit {
  file: "sensor.circuit.tsx", place: false,
  sheets: {
    Power: {
      parts: [ { name: "U1", part: "AP2112K-3.3" },
               { name: "C1", kind: "capacitor", value: "1uF", footprint: "0603" },
               { name: "C2", kind: "capacitor", value: "1uF", footprint: "0603" } ],
      nets: { VIN: ["U1.VIN", "U1.EN", "C1.pin1"], VOUT: ["U1.VOUT", "C2.pin1"],
              GND: ["U1.GND", "C1.pin2", "C2.pin2"] },
      ports: ["VIN", "VOUT", "GND"] },
    Channel: {
      parts: [ { name: "R1", kind: "resistor", value: "1k", footprint: "0402" },
               { name: "C1", kind: "capacitor", value: "100nF", footprint: "0402" } ],
      nets: { IN: ["R1.pin1"], OUT: ["R1.pin2", "C1.pin1"], GND: ["C1.pin2"] },
      ports: ["IN", "OUT", "GND"] } },
  instances: [
    { sheet: "Power", name: "PS1", connections: { VIN: "V5", VOUT: "V3_3", GND: "GND" } },
    { sheet: "Channel", name: "CH1", connections: { IN: "S1", OUT: "ADC1", GND: "GND" } },
    { sheet: "Channel", name: "CH2", connections: { IN: "S2", OUT: "ADC2", GND: "GND" } } ],
  parts: [ { name: "U1", part: "ATTINY814" },
           { name: "C1", kind: "capacitor", value: "100nF", footprint: "0402" },
           { name: "J1", kind: "pinheader", props: { pinCount: 4 } },
           { name: "J2", kind: "pinheader", props: { pinCount: 3 } } ],
  nets: { V5: ["J1.pin1"], GND: ["J1.pin2", "J2.pin3", "U1.GND", "C1.pin2"], S1: ["J1.pin3"],
          S2: ["J1.pin4"], V3_3: ["U1.VCC", "C1.pin1", "J2.pin1"], UPDI: ["U1.UPDI", "J2.pin2"],
          ADC1: ["U1.PA4"], ADC2: ["U1.PA5"] } }
→ Change c0004: wrote sensor.circuit.tsx, Power.sheet.tsx, Channel.sheet.tsx
  4 parts, 3 instances
  PS1 Power base 100: VIN=V5 VOUT=V3_3 GND=GND
  CH1 Channel base 200: IN=S1 OUT=ADC1 GND=GND
  CH2 Channel base 300: IN=S2 OUT=ADC2 GND=GND
  8 nets, 14 traces
  Now call check_circuit once.
```

Inside the sheets the designators are local; on the board they are U101, C101, C102 (PS1),
R201, C201 (CH1), R301, C301 (CH2). A third channel later is one edit:
`edit_circuit { file, edits: [{ add_instance: { sheet: "Channel", name: "CH3", connections: { IN: "S3", OUT: "ADC3", GND: "GND" } } }] }`.

```
check_circuit { file: "sensor.circuit.tsx" }
→ sensor.circuit.tsx: 0 errors, 9 warnings
  warning pin-unconnected [U1.PA6]: …
```

Fix every error; unused MCU pins and `unrouted` are warnings to mention.

## 5. Ask the person before the PCB

Stop and ask, in one message, then wait:

> The schematic is done: Power (AP2112K-3.3, 2 × 1 µF), MCU (ATtiny814, 100 nF), two sensor
> channels (1 kΩ + 100 nF each, one sheet used twice), J1 4-pin sensor header and J2 UPDI header.
> AP2112K-3.3 and ATTINY814 are new library parts and NOT verified. 0 errors, 9 warnings
> (unused MCU pins). Shall I go on to the board?

On a yes:

```
note_decision { file: "sensor.circuit.tsx", text: "Schematic approved; AP2112K-3.3 and ATtiny814 unverified" }
→ Change c0005: noted under Decisions in PROJECT.md
```

## 6. Place block by block

The MCU first (most connections), then the blocks round it, then the connectors.

```
autoplace { file: "sensor.circuit.tsx", parts: ["U1", "C1"] }
→ Placed 2 parts; wire length 96 mm (was 140); board 30 × 20 mm; 0 overlaps
  Change c0006; undo_change takes it back.
autoplace { file: "sensor.circuit.tsx", instance: "PS1" }
→ Placed 3 parts; …
autoplace { file: "sensor.circuit.tsx", instance: "CH1" }
→ Placed 2 parts; …
autoplace { file: "sensor.circuit.tsx", instance: "CH2" }
→ Placed 2 parts; wire length 78 mm (was 85); board 30 × 20 mm; 0 overlaps
  Change c0009; undo_change takes it back.
  Notes: CH2 was moved as a block, keeping the arrangement of CH1
autoplace { file: "sensor.circuit.tsx", parts: ["J1", "J2"] }
→ Placed 2 parts; wire length 61 mm (was 88); board 30 × 20 mm; 0 overlaps
fit_board { file: "sensor.circuit.tsx" }
→ Change c0011: board 24 × 17 mm (margin 2 mm)
```

A sheet holds one layout for all its instances: placing CH1 wrote the positions into
`Channel.sheet.tsx`, so CH2 took the same layout on top of CH1. `autoplace` on
CH2 (or on the whole board) moves the other instance as a whole: it sets the instance's `pcbX`,
`pcbY` so its copy overlaps nothing, near what it connects to. A locked instance stays. Then look
with `board_summary`.

## 7. Look, tune, pour, route

```
board_summary { file: "sensor.circuit.tsx" }
→ sensor.circuit.tsx: Board 24 × 17 mm, 2 layers, courtyards use 31%; 11 parts, 8 nets
  C1 100nF 0402 @(4.1, 2.0) r0 top
  …
  Longest unrouted connections (10 of 17): …
  Pours: none
  Unrouted: 17 connections
add_pour { file: "sensor.circuit.tsx", net: "GND", layer: "top" }
→ Change c0012: added copperpour:1 (GND, top)
  copperpour:1 GND top: 301.20 mm², joins 9 pads
autoroute { file: "sensor.circuit.tsx" }
→ Change c0013: Routed 8 of 8 connections in 1 pass
check_circuit { file: "sensor.circuit.tsx" }
→ sensor.circuit.tsx: 0 errors, 7 warnings
```

A part that sits badly in `board_summary` (overlapping, off the board, a long line) is moved
with `set_props { pcbX, pcbY, pcbRotation }` or placed again with `autoplace` before routing.

## 8. Export and remember

```
export_fabrication { file: "sensor.circuit.tsx" }
→ Wrote 11 files to sensor-fab/ and sensor-fab.zip:
  …
  Warning: …
  Next, a person should …
note_decision { file: "sensor.circuit.tsx", text: "Board 24 x 17 mm, GND pour top, routed on two layers" }
set_project { blocks: [ …each block with status "routed"… ], open: ["human: verify AP2112K-3.3 and ATTINY814", "order"] }
```

Then tell the human the change ids and what you did not verify.
