# Writing code the human can edit

copperflow writes visual edits back into the source only where it can read the code
without running it. Code outside this subset still works, but it is read-only in the
editor and in the tools.

## Parts

- One JSX element per part, with a string-literal name: `<resistor name="R4" ... />`.
- Names are unique within a file.
- Position, rotation and values are literals: `pcbX={4.5}`, `pcbRotation={-90}`,
  `resistance="10k"`. Avoid `pcbX={x + 2}` or `pcbX={offset}` for anything the human may move.
- No spread props (`{...props}`) on parts the human should edit.
- Avoid `.map()` for parts the human will place one by one. A loop is fine for a row of
  identical parts that move together; they are shown as read-only.
- Objects such as `pinLabels={{ pin1: "VIN" }}` are fine; they are shown read-only, and the
  part's other props stay editable.

## Traces

- Literal selectors: `<trace from=".R1 > .pin1" to="net.GND" />` or `from="R1.pin1"`.
- Put traces as direct children of `<board>`, after the parts, one per line.
- Keep `</board>` on its own line so new traces can be added before it.
- Write `schematicRouteHints` as a literal list of `{ x, y }` points; the editor moves net labels and ground or power symbols by rewriting it.

## Sub-components

A part inside a component defined outside the board, such as
`const Power = () => <group name="power">...</group>`, is editable. Editing it changes every
place the component is used.

## Pin names of the built-in kinds

Every pin answers to `pin<n>` and to the aliases below, so `R1.pin1`, `LED1.anode` and
`.LED1 > .pin1` all work. A `pinLabels` entry for a pin replaces the aliases of that pin; its names
come after `pin<n>`. A label may be one name or a list of names.

| Kind | Pins (number: names) |
|---|---|
| resistor, capacitor, inductor, fuse, crystal, switch | 1: pin1, left; 2: pin2, right |
| capacitor with `polarized` | 1: pin1, pos, anode; 2: pin2, neg, cathode |
| diode, led | 1: pin1, anode, pos; 2: pin2, cathode, neg |
| battery | 1: pin1, pos; 2: pin2, neg |
| potentiometer | 1: pin1; 2: pin2, wiper; 3: pin3 |
| resonator | 1: pin1; 2: pin2, gnd; 3: pin3 |
| pushbutton | 1 to 4: pin1 to pin4 |
| testpoint | 1: pin1 |
| transistor (`type` npn or pnp) | 1: pin1, B, base; 2: pin2, E, emitter; 3: pin3, C, collector |
| mosfet | 1: pin1, G, gate; 2: pin2, S, source; 3: pin3, D, drain |
| pinheader | 1 to `pinCount`: pin\<n\> |
| chip, connector | the numbers in `pinLabels` plus 1 to `pinCount`; with neither, one pin per pad of `footprint` |

A chip, connector or pinheader whose pins cannot be found this way (for example a connector with
only `standard="usb_c"`) has no pins and is reported as an `unsupported-element` error.

## Footprint strings

copperflow makes the pads itself from these `footprint` strings (case does not matter):

| Family | Strings |
|---|---|
| Chip resistors, capacitors, LEDs | `01005`, `0201`, `0402`, `0603`, `0805`, `1206`, `1210`, `1812`, `2010`, `2220`, `2512` |
| Resistor arrays | `array4x0603`, `array4x0402`, `array2x0402` |
| Diodes | `sod123`, `sod123f`, `sod323`, `sod523`, `sod923`, `sod128`, `sma`, `smb`, `smc` (also `do214ac`, `do214aa`, `do214ab`); MELF `minimelf` (`sod80`, `do213aa`), `melf` (`do213ab`) |
| SOT-23 | `sot23`, `sot23_5`, `sot23_6`, `sot23_8`, `sot143` |
| Small SOT | `sot323` (`sc70`), `sot353` (`sc70_5`), `sot363` (`sc70_6`), `sot523`, `sot563`, `sot723` |
| Power SOT, DPAK | `sot223`, `sot89`, `dpak` (`to252`), `d2pak` (`to263`), `d2pak_5`, `d2pak_7` (tab is pad 2) |
| Tantalum (moulded) | `tant_a` … `tant_e`, or `tant3216`, `tant3528`, `tant6032`, `tant7343` (pad 1 is +) |
| SOIC, SOP, SSOP, TSSOP, MSOP, QSOP | `soic<N>` (3.9 mm body, N even 8–16), `soic<N>w` (7.5 mm body: 16, 18, 20, 24, 28), `sop<N>` (5.3 mm, 1.27 mm pitch, N even 8–16), `ssop<N>` (5.3 mm, 0.65 mm pitch: 14, 16, 20, 24, 28), `tssop<N>` (4.4 mm, 0.65 mm pitch, N even 8–28), `msop8`, `msop10`, `qsop<N>` (N 16, 20, 24, 28) |
| Exposed pad on those | `soic8_ep<w>x<h>`, `msop8_ep…`, `msop10_ep…`, `tssop<N>_ep…`: the size is required (bare `_ep` is refused); the pad is number N+1 |
| QFP | `qfp32`, `qfp48`, `qfp64`, `qfp100`; by body and pitch `qfp<N>_<b>x<b>_p<pitch>` such as `lqfp64_10x10_p0.5` (`lqfp`, `tqfp` are the same) |
| QFN | `qfn16`, `qfn32`, `qfn48`, and with the exposed pad `qfn16_ep`, `qfn32_ep`, `qfn48_ep`; by body and pitch `qfn<N>_<b>x<b>_p<pitch>` with an optional `_ep<size>` or `_ep<w>x<h>`, such as `qfn32_5x5_p0.5_ep3.1` |
| DFN | `dfn<N>_<across>x<along>_p<pitch>`, `_ep` as for QFN, such as `dfn8_3x3_p0.65_ep1.6x2.4` |
| BGA | `bga<N>_<x>x<y>_p<pitch>`, a full grid, optional `_rows<R>x<C>`, such as `bga256_17x17_p1` |
| PLCC, SMD DIP | `plcc<N>` (N 20, 28, 32, 44, 52, 68, 84), `smdip<N>` (N 4, 6, 8, 16) |
| DIP (through-hole) | `dip<N>`, rows 7.62 mm apart unless `_w<mm>`, such as `dip28_w15.24` |
| TO packages (through-hole) | `to220`, `to220_2`, `to220_5`, `to247`, `to126`, `to92` (`to92_inline`, straight 1.27 mm leads, is refused: no lands meet the rules; use `to92`) |
| Axial (through-hole) | `axial<body length>x<lead spacing>` with optional `_d<body diameter>`, such as `axial6.3x10.16_d2.5`; diodes `do35`, `do41`, `do15`, `do201ad` (pad 2 cathode) |
| LEDs | `led3mm`, `led5mm` (through-hole); `led3528`, `led5050`, `led5050_6` (surface mount) |
| Crystals | `hc49`, `hc49s` (through-hole); `hc49smd`, `xtal2016`, `xtal2520`, `xtal3225`, `xtal5032`, `xtal5032_2`, `xtal3215`, `xtal7050` (surface mount) |
| Radial electrolytics | `radial<can>x<lead spacing>`, such as `radial6.3x2.5` |
| SMD electrolytic cans | `smdcan4x5.4`, `smdcan5x5.4`, `smdcan6.3x5.4`, `smdcan6.3x7.7`, `smdcan8x6.5`, `smdcan8x10.2`, `smdcan10x10.2` |
| Pin rows (through-hole) | `pinrow<N>`: N pins at 2.54 mm, or at a pitch `_p<pitch>` larger than the 1.7 mm pad, such as `pinrow4_p2mm`; two rows `pinrow2x<N>` (odd pins on top) |
| Uno parts | `resonator3213`; `usb_b`, `usb_c16` (shell legs share the last pad number); `dcjack` (also `dcjack2.1`, `dcjack2.5`); `tact6x6`, `tact6x6_smd` (1–2 and 3–4 joined); `ind4x4`, `ind5x5`, `ind6x6`, `ind8x8`, `ind10x10`, `ind12x12` |
| Sockets, screw terminals | `socket<N>`, `socket2x<N>` (as the pin rows); `screw<N>` (N 2–24), optional `_p3.5`, `_p3.81`, `_p5`, `_p5.08` |

`docs/footprints.md` in the copperflow repository draws each family and says how sure its numbers
are. A parameter such as `_p1.27mm` on a cited package (`soic8_p1.27mm`) is accepted only when it
matches the package. Any other string, such as `sot666` or `to3`, gives the error
`copperflow cannot make footprint "<string>": known families are …`, naming the nearest valid
strings first when it looks like a known family (`soic18`: `soic14, soic16, soic18w`).
For a package no family fits, a library part carries its own `footprint.yaml` (see
[parts-library.md](parts-library.md)).
