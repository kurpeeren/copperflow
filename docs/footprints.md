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
  general knowledge and say so in `dual.ts`.
- **Typical**: packages named by body and pitch (`qfn…_<b>x<b>_p…`, `dfn…`, `lqfp…`, `bga…`) and the remaining
  families (DO-214, SOT-223, SOT-89, DIP, TO-220, TO-92, HC-49, radial) take the typical JEDEC or maker dimensions
  written from general knowledge, not transcribed from one drawing. Where those ranges meet a cited table they give
  the same pads (`qfn32_5x5_p0.5` = `qfn32`, `lqfp64_10x10_p0.5` = `qfp64`), and the tests check that.
- **Remembered goals**: the IPC-7351B goal tables for QFN (3-15), gull-wing (3-2, 3-3) and chips (3-5, 3-6) are
  sourced in `ipc7351.ts`. The molded-body goals (DO-214), the BGA land reduction and BGA courtyard, and the
  through-hole hole and land allowances are written from general knowledge of the standards and say so in the code.
  DFN uses the QFN goals (Table 3-15) because the SON table (3-16) was not at hand.

Check a generated footprint against the part's datasheet before ordering boards; the Studio's footprint preview and
the `origin` line of each footprint say which package and which numbers were used.

## Strings

| Family | Example | Form |
| --- | --- | --- |
| SOIC, narrow (3.9 mm) | `soic8` | `soic<N>`, N even 8–16 (JEDEC MS-012) |
| SOIC, wide (7.5 mm) | `soic18w` | `soic<N>w`, N 16, 18, 20, 24, 28 (JEDEC MS-013) |
| SOP (5.3 mm, 1.27 mm pitch) | `sop8` | `sop<N>`, N even 8–16 |
| SSOP (5.3 mm, 0.65 mm pitch) | `ssop20` | `ssop<N>`, N even 8–28 (JEDEC MO-150) |
| TSSOP (4.4 mm, 0.65 mm pitch) | `tssop20` | `tssop<N>`, N even 8–28 (JEDEC MO-153) |
| QFN, from a table | `qfn32_ep` | `qfn16`, `qfn32`, `qfn48`, with `_ep` for the cited exposed pad |
| QFN, by body and pitch | `qfn32_5x5_p0.5_ep3.1` | `qfn<N>_<b>x<b>_p<pitch>`, pitch 0.4, 0.5 or 0.65; `_ep<size>` or `_ep<w>x<h>` |
| DFN | `dfn8_3x3_p0.65_ep1.6x2.4` | `dfn<N>_<across>x<along>_p<pitch>`, pitch 0.4, 0.5 or 0.65; `_ep` as for QFN |
| QFP, from a table | `qfp64` | `qfp32`, `qfp48`, `qfp64`, `qfp100`; `lqfp` and `tqfp` are the same |
| QFP, by body and pitch | `lqfp64_10x10_p0.5` | `qfp<N>_<b>x<b>_p<pitch>` (or `lqfp`, `tqfp`), pitch 0.4, 0.5, 0.65 or 0.8 |
| BGA | `bga256_17x17_p1` | `bga<N>_<x>x<y>_p<pitch>`, optional `_rows<R>x<C>`; pitch 0.4, 0.5, 0.65, 0.8, 1 or 1.27 |
| SOD | `sod123` | `sod123`, `sod323` |
| DO-214 | `sma` | `sma`, `smb`, `smc`, or `do214ac`, `do214aa`, `do214ab` |
| SOT-223 | `sot223` | `sot223` |
| SOT-89 | `sot89` | `sot89` |
| DIP | `dip8` | `dip<N>`, optional `_w<row spacing>` (7.62 mm unless given, never narrower) |
| TO-220 | `to220` | `to220` |
| TO-92 | `to92` | `to92` (leads formed to 2.54 mm) |
| Crystal | `hc49s` | `hc49`, `hc49s` |
| Radial electrolytic | `radial6.3x2.5` | `radial<can diameter>x<lead spacing>` |
| Two-row header | `pinrow2x5` | `pinrow2x<N>` (N pins per row), optional `_p<pitch>` over 1.7 mm |

The older families (chips `0402`…`2512`, `sot23`, `sot23_5`, `sot23_6`, `pinrow<N>`) are listed in
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
`skills/copperflow/references/design-rules.md`): `sot223` is 180 like `sot`, every other new family 0.

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
are taken formed to 2.54 mm. A short line in front of pad 1 marks it.

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
