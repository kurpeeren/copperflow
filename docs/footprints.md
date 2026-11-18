# Footprints

copperflow makes a part's pads, courtyard, body outline and silkscreen from a footprint string, such as `soic8` or
`qfn32_5x5_p0.5_ep3.1`. The generator is in `src/engine/footprints/`, one module per family; the land patterns follow
the IPC-7351B nominal (density level B) equations in `ipc7351.ts`, and through-hole lands the IPC-2222 / IPC-7251
level B rule in `ipc7251.ts`. No code or data is taken from KiCad or any other GPL tool.

Every footprint is drawn seen from the top, origin at the part centre, y up, mm. Pad 1 is always marked on the
silkscreen. Strings are case-insensitive; lengths may carry `mm`, `mil` or `in` (`_p100mil`). A string that no family
accepts gives the error `copperflow cannot make footprint "<string>": known families are …` with the string forms on
one line, preceded by `nearest are …` (up to three valid strings) when it looks like a known family with a bad number
or suffix, such as `soic18` (nearest `soic14, soic16, soic18w`); see `known.ts`. A part with such a package carries its own
`footprint.yaml` (see `skills/copperflow/references/parts-library.md`).

## How sure the numbers are

- **Cited**: the package dimensions come from a named maker's outline drawing (chips, SOD-123/323, SOT-23, narrow
  SOIC, SOP, TSSOP leads, the `qfn16/32/48` and `qfp32/48/64/100` tables). Each source is named in the module. The
  wide SOIC (MS-013), SSOP (MO-150) and the TSSOP body lengths for 8, 24 and 28 pins are JEDEC values written from
  general knowledge and say so in `dual.ts`. Cited with the later families: SOD-523 (NXP; the drawing gives no foot
  length, so the foot is derived from its other cited values), SOT-323, SOT-353 and SOT-363 (NXP), MSOP-8 (Diodes
  Inc.), the tantalum cases A to D and X (KEMET T491; `tant_e` is KEMET's X, the 7343-43 case), DPAK and D2PAK
  (onsemi case outlines), the TO-247 body and leads (onsemi case outline), the 3225 crystal's land pattern (Abracon
  ABM8) and the SMD aluminium can lands (Nichicon CAT.8100N). Cited with the Arduino Uno parts, each one maker's part
  (another maker's may need other lands): `usb_b` (Würth 61400416121), `usb_c16` (Würth 629722000214), `dcjack`
  (Würth 694106301002), `tact6x6` (Würth 430186043716) and `tact6x6_smd` (Würth 430182043816).
- **Typical**: packages named by body and pitch (`qfn…_<b>x<b>_p…`, `dfn…`, `lqfp…`, `bga…`) and the remaining
  families (DO-214, SOT-223, SOT-89, DIP, TO-220, TO-92, HC-49, radial) take the typical JEDEC or maker dimensions
  written from general knowledge, not transcribed from one drawing. So do the later families apart from the cited
  ones above: SOD-923, SOD-123F, SOD-128, MiniMELF and MELF, SOT-523, SOT-563, SOT-723, SOT-143, SOT-23-8, MSOP-10, QSOP,
  the exposed pads' lands, resistor arrays, the D2PAK-5 and -7 leads, TO-126, TO-220-2 and -5, the inline TO-92,
  PLCC, SMD DIP, axial parts and diodes, LEDs, screw terminals, pin sockets, the other crystals and the can bodies,
  the ceramic resonator `resonator3213` and the shielded power inductors `ind<a>x<a>`.
  Where those ranges meet a cited table they give the same pads (`qfn32_5x5_p0.5` = `qfn32`, `lqfp64_10x10_p0.5` =
  `qfp64`), and the tests check that.
- **Remembered goals**: the IPC-7351B goal tables for QFN (3-15), gull-wing (3-2, 3-3) and chips (3-5, 3-6) are
  sourced in `ipc7351.ts`. The molded-body goals (DO-214), the BGA land reduction and BGA courtyard, and the
  through-hole hole and land allowances are written from general knowledge of the standards and say so in the code.
  DFN uses the QFN goals (Table 3-15) because the SON table (3-16) was not at hand. SOD-523, SOD-923, SOD-123F and
  SOD-128 have flat leads, which IPC-7351B gives their own goals (Table 3-22); that table was not at hand either, so
  they take Table 3-2 with Note 1, as SOD-123 and SOD-323 do. The MELF goals and the resistor arrays' (the chip goals,
  chosen by the terminal span) are written from general knowledge and say so in the code.

Check a generated footprint against the part's datasheet before ordering boards; the Studio's footprint preview and
the `origin` line of each footprint say which package and which numbers were used.

## Strings

| Family | Example | Form |
| --- | --- | --- |
| SOIC, narrow (3.9 mm) | `soic8` | `soic<N>`, N even 8–16 (JEDEC MS-012) |
| SOIC, wide (7.5 mm) | `soic18w` | `soic<N>w`, N 16, 18, 20, 24, 28 (JEDEC MS-013) |
| SOP (5.3 mm, 1.27 mm pitch) | `sop8` | `sop<N>`, N even 8–16 |
| SSOP (5.3 mm, 0.65 mm pitch) | `ssop20` | `ssop<N>`, N 14, 16, 20, 24, 28 (JEDEC MO-150) |
| TSSOP (4.4 mm, 0.65 mm pitch) | `tssop20` | `tssop<N>`, N even 8–28 (JEDEC MO-153) |
| MSOP (3 mm body) | `msop8` | `msop8` (0.65 mm pitch), `msop10` (0.5 mm pitch) (JEDEC MO-187) |
| QSOP (3.9 mm, 0.635 mm pitch) | `qsop16` | `qsop<N>`, N 16, 20, 24, 28 (JEDEC MO-137) |
| Dual with an exposed pad | `soic8_ep2.3x2.3` | `soic8_ep<w>x<h>`, `msop8_ep…`, `msop10_ep…`, `tssop<N>_ep…`; the size is required |
| PLCC | `plcc28` | `plcc<N>`, N 20, 28, 32, 44, 52, 68, 84 |
| SMD DIP | `smdip8` | `smdip<N>`, N 4, 6, 8, 16 |
| QFN, from a table | `qfn32_ep` | `qfn16`, `qfn32`, `qfn48`, with `_ep` for the cited exposed pad |
| QFN, by body and pitch | `qfn32_5x5_p0.5_ep3.1` | `qfn<N>_<b>x<b>_p<pitch>`, pitch 0.4, 0.5 or 0.65; `_ep<size>` or `_ep<w>x<h>` |
| DFN | `dfn8_3x3_p0.65_ep1.6x2.4` | `dfn<N>_<across>x<along>_p<pitch>`, pitch 0.4, 0.5 or 0.65; `_ep` as for QFN |
| QFP, from a table | `qfp64` | `qfp32`, `qfp48`, `qfp64`, `qfp100`; `lqfp` and `tqfp` are the same |
| QFP, by body and pitch | `lqfp64_10x10_p0.5` | `qfp<N>_<b>x<b>_p<pitch>` (or `lqfp`, `tqfp`), pitch 0.4, 0.5, 0.65 or 0.8 |
| BGA | `bga256_17x17_p1` | `bga<N>_<x>x<y>_p<pitch>`, optional `_rows<R>x<C>`; pitch 0.4, 0.5, 0.65, 0.8, 1 or 1.27 |
| Chip, extra sizes | `01005` | `01005`, `2220` (the others are in the skill's table) |
| SOD | `sod123` | `sod123`, `sod123f`, `sod323`, `sod523`, `sod923`, `sod128` |
| MELF | `minimelf` | `minimelf` (`sod80`, `do213aa`), `melf` (`do213ab`) |
| DO-214 | `sma` | `sma`, `smb`, `smc`, or `do214ac`, `do214aa`, `do214ab` |
| Small SOT | `sot323` | `sot323` (`sc70`), `sot353` (`sc70_5`), `sot363` (`sc70_6`), `sot523`, `sot563`, `sot723`, `sot143` |
| SOT-23, eight leads | `sot23_8` | `sot23_8` |
| SOT-223 | `sot223` | `sot223` |
| SOT-89 | `sot89` | `sot89` |
| DPAK | `dpak` | `dpak` (`to252`); the tab is pad 2 |
| D2PAK | `d2pak` | `d2pak` (`to263`), `d2pak_5` (`to263_5`), `d2pak_7` (`to263_7`); tab pad 2 on three leads |
| Tantalum | `tant_a` | `tant_a` … `tant_e`, or `tant3216`, `tant3528`, `tant6032`, `tant7343` |
| Resistor array | `array4x0603` | `array4x0603`, `array4x0402`, `array2x0402` |
| DIP | `dip8` | `dip<N>`, optional `_w<row spacing>` (7.62 mm unless given, never narrower) |
| TO-220 | `to220` | `to220`, `to220_2` (5.08 mm), `to220_5` (1.7 mm) |
| TO-247 | `to247` | `to247` |
| TO-126 | `to126` | `to126` |
| TO-92 | `to92` | `to92` (leads formed to 2.54 mm); `to92_inline` is refused, see below |
| Axial | `axial10x15` | `axial<body length>x<lead spacing>`, optional `_d<body diameter>` |
| Axial diodes | `do35` | `do35`, `do41`, `do15`, `do201ad` |
| LED, through-hole | `led5mm` | `led3mm`, `led5mm` |
| LED, surface mount | `led3528` | `led3528`, `led5050`, `led5050_6` |
| Crystal | `hc49s` | `hc49`, `hc49s` |
| Crystal, surface mount | `xtal3225` | `xtal2016`, `xtal2520`, `xtal3225`, `xtal5032`, `xtal5032_2`, `xtal3215`, `xtal7050`, `hc49smd` |
| Radial electrolytic | `radial6.3x2.5` | `radial<can diameter>x<lead spacing>` |
| SMD electrolytic can | `smdcan6.3x5.4` | `smdcan4x5.4`, `smdcan5x5.4`, `smdcan6.3x5.4`, `smdcan6.3x7.7`, `smdcan8x6.5`, `smdcan8x10.2`, `smdcan10x10.2` |
| Two-row header | `pinrow2x5` | `pinrow2x<N>` (N pins per row), optional `_p<pitch>` over 1.7 mm |
| Pin socket | `socket2x5` | `socket<N>`, `socket2x<N>`: the lands and numbering of `pinrow<N>` and `pinrow2x<N>` |
| Ceramic resonator | `resonator3213` | `resonator3213` (three pads, 2 the middle) |
| USB receptacle | `usb_b` | `usb_b` (Type-B, through-hole), `usb_c16` (Type-C, 16 pins, USB 2.0) |
| DC barrel jack | `dcjack` | `dcjack`, `dcjack2.1`, `dcjack2.5` (one footprint, 5.5 mm sleeve, slotted terminals) |
| Tact switch | `tact6x6` | `tact6x6` (through-hole), `tact6x6_smd` |
| Shielded power inductor | `ind6x6` | `ind4x4`, `ind5x5`, `ind6x6`, `ind8x8`, `ind10x10`, `ind12x12` |
| Screw terminal block | `screw4_p5` | `screw<N>`, N 2–24, optional `_p3.5`, `_p3.81`, `_p5` or `_p5.08` (5.08 unless given) |

The older families (chips `0201`…`2512`, `sot23`, `sot23_5`, `sot23_6`, `pinrow<N>`) are listed in
`skills/copperflow/references/editable-subset.md`.

### Dual gull-wing packages by pin count

`soic`, `soic…w`, `sop`, `ssop` and `tssop` share one generator (`dual.ts`): each series has one lead outline (pitch,
toe-to-toe span, foot length and lead width with their tolerances, body width), and the pin count only sets the
number of pads and the body length. The body length is the outline drawing's where it lists that count, and
otherwise the mean overhang of the listed sizes past the outer leads. The pads come from the IPC-7351B equations with
the gull-wing goals (Table 3-2 above 0.625 mm pitch). On the heel side the RMS tolerance is taken once: Smax' already
moves the inner edge by the statistical S tolerance, so G = Smax' − 2·Jh − √(CL² + F² + P²) (`gullWingPattern` in
`ipc7351.ts`). That puts `soic8` at 1.525 × 0.60 mm pads with centres ±2.69 mm, the IPC-7351B nominal
SOIC127P600X175-8N (1.55 × 0.60 at ±2.70), and `soic18w` at 1.675 × 0.60 at ±4.84 mm. The same gull-wing row serves
`sot23…`, `sot223`, `sot89` and the QFP families; the two-terminal SOD and DO-214 patterns keep the general form.

The `soic<N>w` (JEDEC MS-013) and `ssop<N>` (JEDEC MO-150) outline dimensions were written from memory, not copied
from the drawings. Their pads follow the same formula that reproduces the published SOIC-8 pattern. A maker's
recommended pattern can differ: for an 18-lead wide SOIC, pads about 2.0 mm long reach about 0.3 mm further in at the
heel than `soic18w`'s 1.675 mm. A part created with one of these packages gets a checklist line in its
`verification.md` asking for the pads to be compared with the maker's land pattern.

A name is normalised: `QFN32_5mmx5mm_p0.50mm_EP3.10` is made as `qfn32_5x5_p0.5_ep3.1`. Two pads of a generated
footprint keep at least 0.1 mm of copper between them; a string whose pads would come closer (a large exposed pad, a
crowded corner) is refused rather than drawn. A string of a known family that cannot be made says why, for example
`copperflow cannot make footprint "qfn32_5x6_p0.5": QFN bodies must be square` or `… "do214": do214 needs a suffix:
do214ac, do214aa or do214ab`.

Each family has its own pick-and-place rotation correction (`fabrication.placementRotations` in `rules.yaml`, see
`skills/copperflow/references/design-rules.md`): `sot223` is 180 like `sot`, and `msop` and `qsop` are 270 like `tssop`
and `ssop` because the same generator draws them the same way; every other new family is 0. The small SOTs and
`sot23_8` are `sot`, MELF and the other SODs are `sod`, `to252` is `dpak`, `to263` is `d2pak`, `to220_2` and
`to220_5` are `to220`, the axial diodes are `axial`, and an exposed-pad dual keeps its
kind.

## The families

In the drawings `#` is a pad, `[]` pad 1 where it is square, `o` a round pad or ball, `·` the body, and the lines are
silkscreen. Numbers show the pin order.

### QFN and QFP

Pin 1 at the top of the left side, then counter-clockwise: down the left side, along the bottom left to right, up the
right side, along the top right to left. The exposed pad is the last number (33 on a QFN-32). The silkscreen draws an L
at each body corner, clear of the pads; the top-left one runs on to the outer end of pad 1.

```
   ──────   32 31 30 29 28 27 26 25   ┐
             #  #  #  #  #  #  #  #   │
  1 ##                             ## 24
  2 ##     ┌───────────────────┐   ## 23
  3 ##     │                   │   ## 22
  4 ##     │   exposed pad 33  │   ## 21
  5 ##     │                   │   ## 20
  6 ##     └───────────────────┘   ## 19
  7 ##                             ## 18
  8 ##                             ## 17
  └          #  #  #  #  #  #  #  #   ┘
             9 10 11 12 13 14 15 16
```

QFN terminals end at the body edge (Table 3-15: toe 0.30, heel 0, side −0.04); QFP gull-wing leads reach 1 mm past
the body on each side (Table 3-3 at 0.625 mm pitch and under, Table 3-2 above). For a QFP named by body and pitch the
toe-to-toe span is the body + 2 mm (MS-026), ±0.15 mm up to a 10 mm body and ±0.25 mm above.

### DFN

Two columns, left and right across the first body size; pad 1 at the top of the left column, numbered counter-clockwise
as on a SOIC; the exposed pad last. The silkscreen lines run along the top and bottom body edges; the top one reaches
over pad 1.

```
  ───────────────
  1 ##  ┌─────┐  ## 8
  2 ##  │ ep  │  ## 7
  3 ##  │  9  │  ## 6
  4 ##  └─────┘  ## 5
       ─────────
```

### BGA

A full grid. Ball A1 at the top left; rows go down A, B, C, … skipping I, O, Q, S, X and Z, then AA, AB, …; columns
1, 2, 3, … left to right. Lands are round and smaller than the ball (20% for balls under 0.55 mm, 25% from 0.55 mm); the ball by pitch is
0.75 at 1.27, 0.50 at 1.0, 0.45 at 0.8 (JEDEC MO-275), 0.35 at 0.65, 0.30 at 0.5 and 0.25 at 0.4 mm.
The silkscreen is the body outline, with a bracket outside its top-left corner by A1. The courtyard is the body +
1.0 mm.

```
  ┌──
  │ ┌─────────────────────┐
    │  o  o  o  o  o  o   │   A   A1 is the top-left ball
    │  o  o  o  o  o  o   │   B
    │  o  o  o  o  o  o   │   C
    │  o  o  o  o  o  o   │   D
    └─────────────────────┘
       1  2  3  4  5  6
```

### SOD and DO-214 diodes

Two pads along x; **pad 1 is the anode, pad 2 the cathode**, for `sod123`, `sod323`, `sma`, `smb`, `smc` and the
`do214…` names alike. Some sources number the cathode 1 (many datasheets and part libraries do): a part imported from
such a source must map its cathode pin to pad 2. Silkscreen lines run along the body between the pads, with a cathode
bar on the pad 2 side. DO-214 (SMA, SMB, SMC) uses the molded-body goals (toe 0.15, heel 0.50, side −0.05).

```
       ─────────
    ##           | ##
  1 ##           | ## 2  (cathode)
    ##           | ##
       ─────────
```

### SOT-223 and SOT-89

Three leads along the bottom (1, 2, 3 left to right) and a wide tab on top: pad 4 on a SOT-223, a second pad 2 on a
SOT-89 (its tab is joined to pin 2), whose land runs on under the body to 0.3 mm short of the lead lands, as the
slug under a SOT-89 is pin 2. The silkscreen draws the body's left and right edges; the left line runs down past
pad 1.

```
           ###########
           ###  4  ###
     │     ###########     │
     │  · · · · · · · · ·  │
     │                     │
       ##       ##      ##
       ##       ##      ##
       1        2       3
```

### DIP

Through-hole, 2.54 mm pitch, rows 7.62 mm apart unless `_w` says otherwise. Pin 1 at the top left (square), down the
left column, up the right. The silkscreen outline lies between the columns with a notch at the top end.

```
        ┌───╮ ╭───┐
  1 []  │   ╰─╯   │  o 8
  2 o   │         │  o 7
  3 o   │         │  o 6
  4 o   │         │  o 5
        └─────────┘
```

### TO-220 and TO-92

Three leads in a row, pin 1 at the left seen from the front (−y), square. TO-220 stands upright: the silkscreen is
the body with the metal tab behind the leads; the lead plane is 2.0 mm behind the front face and 2.5 mm in front of
the tab's back. TO-92 has the flat face in front and the round back behind; its leads
are taken formed to 2.54 mm; the straight 1.27 mm form is refused (see "More TO packages"). A short line in front of pad 1 marks it.

```
  TO-220                          TO-92
  ┌─────────────────────┐            ╭───────╮
  ├─────── tab ─────────┤          ╭─╯       ╰─╮
  │  []      o      o   │         []     o     o
  └─────────────────────┘          ╰───────────╯
    ──                              ──
    1        2      3               1    2     3
```

### HC-49 crystals

Two leads 4.88 mm apart inside the case outline (straight sides, round ends); pad 1 square with a short line below it.
`hc49` (HC-49/U) and `hc49s` (HC-49/S, low profile) differ only in height, so their pads are the same.

```
   ╭───────────────────────╮
  (     []           o      )
   ╰───────────────────────╯
        ──
        1            2
```

### Radial electrolytics

Two leads along x, pad 1 (positive, square) at the left with a `+` above it, the can as a circle. Lead diameter by
can: 0.45 mm below 8 mm, 0.6 mm up to 10 mm, 0.8 mm above.

```
        ╭─────────╮
      ╱   +         ╲
     │   []      o   │
      ╲             ╱
        ╰─────────╯
         1       2
```

### Two-row pin headers

`pinrow2x<N>`: N pins per row, numbered as on a ribbon cable header: odd pins along the top row, even along the
bottom, pin 1 at the top left with pin 2 under it. Pads as for `pinrow<N>` (1.0 mm drill, 1.7 mm pads, pad 1 square);
a tick left of the outline marks pin 1, and the courtyard is widened to hold it.

```
   ┌──────────────────┐
 │ │ []  o   o   o  o │    1  3  5  7  9
   │ o   o   o   o  o │    2  4  6  8 10
   └──────────────────┘
```

## Families added later

Each of these has its module in `src/engine/footprints/`, whose top comment names the document its numbers come from
or says they are typical (see "How sure the numbers are"). Pin functions are not part of a footprint: a part's own
sheet says which pin does what.

### Chips 01005 and 2220, SOD and MELF

`01005` and `2220` are chips like the others, two pads along x. `sod523`, `sod923`, `sod123f`, `sod128`, `minimelf` and
`melf` are drawn as `sod123`: **pad 1 the anode, pad 2 the cathode**, the cathode bar on the pad 2 side. `sod80` and
`do213aa` are `minimelf`, `do213ab` is `melf`. Refused: `sod` followed by any other number, `do213` without a suffix
(nearest strings are named), and a parameter on any of them.

### Small SOTs and SOT-23-8

`sot323`, `sot353`, `sot363` (`sc70`, `sc70_5`, `sc70_6`), `sot523`, `sot563`, `sot723`, `sot143` and `sot23_8` are
numbered as `sot23`: pin 1 at the left of the bottom row, counter-clockwise seen from the top, so a three-lead part has
pins 1 and 2 below and 3 above, and a six-lead part 1 to 3 below and 4 to 6 above. SOT-143's pin 1 is the wide lead.
Refused: a variant other than the sizes listed (`sc70_4`, `sot23_8_x`).

### DPAK and D2PAK

```
         ###########        the tab, wide, on top
         ###########
    ##                  ##
    ##                  ##
    1                   3        pin 2 is the tab
```

Leads along the bottom, the tab on top. The leads are pads 1 and 3 and **the tab is pad 2** (the cut middle lead's
terminal), so a three-pin part maps its pins straight onto the pads. `d2pak_5` and `d2pak_7` have five and seven leads
at 1.70 and 1.27 mm and the tab takes the number after the last lead (6 and 8). Refused: a variant or parameter on
`dpak` or on a three-lead `d2pak`, and any lead count other than 3, 5 or 7.

### Tantalum capacitors

`tant_a` … `tant_e` (EIA 3216, 3528, 6032, 7343-31 and 7343-43) or `tant3216`, `tant3528`, `tant6032`, `tant7343`.
Two pads along x, **pad 1 the anode (+) at the left** with a `+` above it, as the radial parts mark theirs. `tant_d` and
`tant7343` are the same case; `tant_e` is the taller 7343-43. Refused: any other letter or size.

### MSOP, QSOP and an exposed pad on dual packages

`msop8`, `msop10` and `qsop16/20/24/28` are made by the generator of the SOIC and TSSOP series (see above), numbered
the same way. An exposed pad is allowed on `soic8`, `msop8`, `msop10` and every `tssop<N>`: `_ep<w>x<h>` or `_ep<side>`,
as for QFN, and it is pad N + 1 at the centre. Its size differs from part to part, so a bare `_ep` is refused with that
reason, as is a pad that would touch the pins; `soic14_ep2x2` and the like are unknown strings.

### Resistor arrays

`array4x0603`, `array4x0402`, `array2x0402`: a terminal at each end of each resistor, pad 1 at the left of the bottom
row, counter-clockwise (bottom row left to right, then the top row back), so a four-resistor array has pads 1 to 4
below and 5 to 8 above. The resistor with bottom pad k has top pad 2·count + 1 − k (pads 1 and 8, 2 and 7 … on four). Refused: any other count or size.

### PLCC and SMD DIP

`plcc<N>` has J-leads at 1.27 mm on four sides. Pad 1 is in the middle of the top side, then counter-clockwise seen from
the top as the JEDEC outlines number them: leftwards along the top, down the left side, along the bottom left to right,
up the right side, and leftwards along the top back to pad 1. The 32-lead PLCC is the rectangular one. `smdip<N>` is a
300 mil DIP with gull wings: numbered as a DIP, pad 1 at the top of the left column. Refused: any other pin count, and
any variant or parameter.

### More TO packages

`to220_2` (5.08 mm, the middle lead left out) and `to220_5` (five leads at 1.70 mm, oval lands) are laid out as
`to220`, numbered left to right seen from the front, pad 1 square. `to247` and `to126` have three leads and no separate
tab. The TO-92 with straight leads at 1.27 mm (`to92_inline`) is refused: the 0.74 mm lead diagonal needs a hole of at
least 0.75 mm, and with the 0.18 mm ring that leaves under 0.2 mm of copper between neighbouring lands; use `to92`, the
leads formed to 2.54 mm. Refused: a variant on `to247`, `to126` or `to220_2` (`to220_4`, `to247_3`), and any other TO number
(`to248`).

### Axial parts and diodes

`axial<body length>x<lead spacing>` such as `axial6.3x10.16`, optional `_d<body diameter>` (taken from the body length
when not given). Two pads along x, pad 1 square at the left. The leads need 1.5 mm of straight lead out of the body
before the bend, so the spacing must be at least the body length plus 3 mm (the refusal says the least). `do35`,
`do41`, `do15` and `do201ad` are the diodes: **pad 1 the anode, pad 2 the cathode**, with a bar near the pad 2 end.

### LEDs

`led3mm` and `led5mm`: through-hole, pad 1 the anode (square), pad 2 the cathode on the side of the flat. `led3528`:
two pads, pad 1 the anode, pad 2 the cathode with a bar on its side. `led5050` (four pads) and `led5050_6` (six) are
numbered counter-clockwise from the bottom left; the pin functions (RGB, single colour, addressable) differ between
parts, so the part's own sheet decides them.

### Screw terminals, pin sockets and SMD cans

`screw<N>` puts N solder pins 1.0 mm square in a row along x at 5.08 mm unless `_p` gives 3.5, 3.81, 5 or 5.08; pad 1 at
the left, square, with a tick below it. The block outline is a guide: real blocks often put the pins off the centre of
their depth. `socket<N>` and `socket2x<N>` have the lands and numbering of `pinrow<N>` and `pinrow2x<N>`, made by that
family so the two cannot drift apart. `smdcan<D>x<H>` is a surface-mount aluminium can on a square base with the plus-side
corners clipped: **pad 1 (plus) at the left**, pad 2 at the right, a `+` above pad 1. Refused: a size not in the list
(the refusal names them), a pitch other than the four.

### Surface-mount crystals

The four-pad `xtal2016`, `xtal2520`, `xtal3225` and `xtal5032` are numbered counter-clockwise from the bottom left; the
crystal is across pads 1 and 3 and pads 2 and 4 are tied to the lid, so connect them to ground. `xtal7050` is an
oscillator: pads 1 enable, 2 ground, 3 output, 4 supply, as is usual, to be checked against the part's sheet.
`xtal5032_2`, `xtal3215` (32.768 kHz) and `hc49smd` have two pads, pad 1 at the left.

### Arduino Uno parts: resonator, USB, DC jack, tact switches, inductors

These are not JEDEC packages, so each footprint is one maker's part (the module names the drawing, its revision and
page); another maker's part of the same kind may need different lands. Pad numbers are digits, because a pad joins
the pin of its number; the shell legs of a receptacle share one number, as a SOT-89's tab shares pin 2.

`resonator3213` has three pads in a row 1.2 mm apart: 1 and 3 the resonator's ends, 2 the middle, to ground (typical).

`usb_b` (Würth 61400416121): pins 1 VBUS, 2 D−, 3 D+, 4 GND as the USB specification numbers them, pad 1 square at
the rear right seen from the top; the two shell legs are pad 5. The plug enters from −y: the fabrication layer marks
that side with an arrow.

`usb_c16` (Würth 629722000214): twelve surface pads, numbered 1 to 12 left to right with the plug at the bottom
(−y): A1/B12 GND, A4/B9 VBUS, B8 SBU2, A5 CC1, B7 D−, A6 D+, A7 D−, B6 D+, A8 SBU1, B5 CC2, B4/A9 VBUS, B1/A12 GND.
The four plated shell slots are pad 13. Join pads 5 and 7 (D−) and 6 and 8 (D+) on the board. The maker's sheet
recommends a 0.8 mm board for this part.

`dcjack` (Würth 694106301002; `dcjack2.1` and `dcjack2.5` give the same footprint): three slotted terminals, 1 the
centre pin, 2 the sleeve, 3 the sleeve's switch contact, which opens when a plug goes in. The plug enters from −y.

`tact6x6` (Würth 430186043716) and `tact6x6_smd` (Würth 430182043816): 1 top left, 2 top right, 3 bottom left,
4 bottom right; 1 and 2 are joined inside the switch, and so are 3 and 4; pressing joins the pairs. Würth numbers the
same corners 1, 3, 2, 4.

`ind<a>x<a>` is a shielded surface-mount power inductor of that body, 4x4, 5x5, 6x6, 8x8, 10x10 or 12x12, with two
pads along x (typical: lands vary between makers; check the part's sheet).
