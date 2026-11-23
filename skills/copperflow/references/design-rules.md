# Starter design rules

A short, conservative set. The datasheet of the part always wins over these rules.
Each rule names its source; contributions should do the same.

## Decoupling

- Place each IC's decoupling capacitors as close to its supply pins as the layout allows,
  with the shortest possible return path to ground.
- Use the values the datasheet recommends. For example, the AP2112K regulator datasheet
  recommends 1 µF ceramic capacitors on the input and output.

Source: device datasheets; H. W. Ott, *Electromagnetic Compatibility Engineering*, Wiley, 2009,
chapter on digital circuit power distribution.

## Trace width for current

IPC-2221 gives a first estimate of the cross-section a trace needs:

    I = k · ΔT^0.44 · A^0.725

I is current in amperes, ΔT the allowed temperature rise in °C, A the cross-section in square
mils, and k = 0.048 for outer layers or 0.024 for inner layers. Width = A / thickness, where
1 oz copper is about 1.378 mil thick.

Example: 0.6 A on an outer layer with a 10 °C rise needs about 8 mil², which is about 6 mil
(0.15 mm) wide in 1 oz copper. Power traces are usually made wider than this minimum.

IPC-2152 replaces the IPC-2221 charts with more detailed data; use it when the margin is small.

`check_circuit` applies this formula as the `track-current` warning:

- **Where the current comes from:** a net's current is the largest current any sheet port on it
  names in its `carries` text, such as "10 A at most" or "33 mA". A net class's `current` (in
  amperes, in `rules.yaml`) counts as well, and the larger of the two is used.
- **The width it asks for:** the width for a 10 °C rise in `fabrication.copperThickness` (1 oz,
  0.035 mm, when the file does not set it). An inner layer needs about 2.6 times the outer width.
- **What it reports:** one warning per net, naming the tracks narrower than that width. Vias are
  not measured; pours are, as the `pour-current` warning below.
- **Fixing it:** give the net a class with that `trackWidth`, then `unroute` and `autoroute` it,
  or carry it in a pour. Write a port's `carries` with the most current it really takes, as a
  number with `A`, `mA` or `µA` ("2 A", "350 mA"); a text that names no current that way gives
  no warning.

A copper pour on such a net gets the same width, as the `pour-current` warning:

- **The neck:** the narrowest the pour's copper gets on its widest way between the pads, tracks
  and vias of its net that it joins on its layer. It is read on a grid that never reads it wider
  than the copper, so the warning gives it as a range (the reading, and the reading plus what
  the grid can lose) and says where it is. Copper too thin for the grid to hold at all is
  still a warning ("too thin for the grid to place"). The copper within half the needed width
  of each pad, track and via is not read, so a pad near the pour's edge is not a neck; where two
  of those areas meet, the copper is read. A pour whose `minWidth` is at least the needed width
  is not read: its fill drops copper narrower than `minWidth`.
- **The spokes:** a relief pour joins each pad through up to four spokes `thermalWidth` wide; a
  pad whose spokes that reach the fill are narrower than the needed width all together is named.
  A spoke counts when its tip is in the fill.
- **Fixing it:** widen the pour where it narrows (move the copper that pinches it, or widen its
  outline), and give it `thermal: "solid"` or a wider `thermalWidth`.

Source: IPC-2221, *Generic Standard on Printed Board Design*; IPC-2152, *Standard for
Determining Current Carrying Capacity in Printed Board Design*.

## USB-C power sink

- A device that only takes power (a sink) needs a separate 5.1 kΩ pull-down (Rd) from each CC
  pin to ground. Do not share one resistor between CC1 and CC2.
- Without Rd, a USB-C source does not turn on VBUS.

Source: USB Type-C Cable and Connector Specification, USB Implementers Forum.

## Enable pins and indicators

- Do not leave enable pins floating; tie them to the level the datasheet requires.
- An indicator LED needs a series resistor: R = (V_supply − V_f) / I. For a red LED
  (V_f about 2 V) on 3.3 V, 1 kΩ gives about 1.3 mA, which is enough for an indicator.

Source: device datasheets.

## Placement

- Part courtyards must not overlap. `check_circuit` reports overlaps as `courtyard-overlap`, so run
  it after every placement change.

Source: IPC-7351, *Generic Requirements for Surface Mount Design and
Land Pattern Standard*, for courtyard definitions.

## The rules.yaml file

A project can state its fabrication limits and net classes in `rules.yaml` at the project root.
Without the file, the `jlcpcb-2layer` profile and the default class apply. Unknown keys are errors.

```yaml
fabrication:
  profile: jlcpcb-2layer    # a built-in profile (jlcpcb-2layer, jlcpcb-4layer); optional
  minClearance: 0.15        # any profile field can be overridden
netClasses:
  power:
    trackWidth: 0.5
    clearance: 0.3
    via: { drill: 0.4, diameter: 0.8 }
    current: 1.4             # amperes its nets carry; optional, for the track- and pour-current checks
    nets: [GND, VBUS, "V*"]  # net names or patterns with * and ?
  field:
    nets: ["IN*", V24]
classClearance:
  - [field, default, 2.5]   # the gap between any copper of these two classes, in mm
globalNets: [GND, V24, V3_3]
```

- Lengths are millimetres, or a number with a unit such as `6mil`.
- Profile fields: `minTrackWidth`, `minClearance`, `minDrill`, `minAnnularRing`,
  `boardEdgeClearance`, `minHoleToHole`, `minSilkToPad`.
- `fabrication.filletRadius` is the radius Fillet tracks (and `fillet_tracks`) rounds corners with,
  1 mm when left out; a track's own width is the floor. It is not a fabrication limit, so the
  profiles do not set it. The Studio's Design → Design rules writes it.
- `fabrication.maskExpansion` is how far each solder mask opening grows past its pad (0.05 mm when
  left out), and `fabrication.pasteReduction` how far the solder paste shrinks inside each SMD pad
  (0 when left out); both may be 0. The fabrication (Gerber) files use them.
- `fabrication.placementRotations` adds degrees (counter-clockwise) to the parts' rotation in the
  pick-and-place file, per footprint family: `chip` (0603, 0805 ...), `sod` (also MELF), `sot` (SOT-23
  and the small SOTs), `sot223`, `sot89`, `soic`, `sop`, `ssop`, `tssop`, `msop`, `qsop`, `qfn`, `dfn`,
  `qfp`, `lqfp`, `tqfp`, `bga`, `sma`, `smb`, `smc`, `do214ac`, `do214aa`, `do214ab`, `tant`, `array`,
  `dpak` (also `to252`), `d2pak` (also `to263`), `plcc`, `smdip`, `dip`, `axial` (also `do35` ...),
  `to220`, `to247`, `to126`, `to92`, `hc49`, `hc49s`, `hc49smd`, `xtal`, `radial`, `smdcan`, `ledth`
  (`led3mm`, `led5mm`), `ledsmd` (`led3528`, `led5050`), `pinrow`, `pinrow2x` (two-row headers),
  `socket`, `socket2x`, `screw`, `resonator`, `usb`, `dcjack`, `tact`, `ind` and `file` (footprint files). Left out, `soic`, `sop`, `ssop`, `tssop`,
  `msop` and `qsop` are 270 and `sot` and `sot223` 180, the corrections commonly used for JLCPCB's
  part models; the small SOTs (`sot323`, `sc70`, `sot143` ...) take `sot`'s 180 because they are drawn as SOT-23 is, which has not been checked in the assembly preview for each, so set `sot` to override; every other family is 0. JLCPCB's assembly preview is the final check: set a family only after the
  preview shows its parts turned, for example `placementRotations: { qfn: 270 }`, and `0` takes a
  default back out. A library part drawn with its own footprint file can have
  its own correction by its id under `parts`, which takes the place of the `file` family's for that
  part only: `placementRotations: { file: 90, parts: { MCP2515: 180 } }`. Bottom parts get the same
  correction, their rotation read as seen from below. Imported footprints (`import_part`) are already
  in JLCPCB's orientation and need none; a footprint file drawn in copperflow's orientation (pin 1 top
  left, rows vertical) for a SOIC- or SOP-like package needs `parts: { <id>: 270 }`.
- The built-in profiles are JLCPCB's published standard capabilities in 1 oz copper; each profile's
  `source` names the page, its sections and the date it was read.
- A class field left out takes the default class's value: track 0.25 mm, clearance 0.2 mm, via drill
  0.3 mm and diameter 0.6 mm. These are copperflow's own conservative choice, above the profile minimums.
- `current` is the current a class's nets carry, in amperes. It does not change the router's width:
  the `track-current` and `pour-current` warnings compare the tracks and pours with the width that
  current needs (see "Trace width for current"). Set `trackWidth` to that width yourself.
- Patterns are case-sensitive and match a net's names. `*` alone matches every net, named or not.
  An unnamed net is in no class otherwise.
- A pattern that starts with `*` must be quoted (`"*GND"`): unquoted, YAML reads it as an alias.
- A net that matches two classes is a `net-class-conflict` error and uses the class written first.
  A pattern that matches no net is a `rules` warning. A problem in the file itself (a bad key, a bad
  length, invalid YAML) is a `rules` error with the file and line, and the default rules then apply.
- Two classes need the largest of their own clearances, their `classClearance` entry (in either
  order) and the profile's `minClearance`.
- `globalNets` lists nets that are supplied from outside the circuit, such as ground and supply rails. The
  `no-power-source` check treats a net with one of these names as having a source.
- Fabrication: start from a profile, then override single fields under `fabrication`. Without
  `profile`, `jlcpcb-2layer` is used. A profile made for another number of copper layers than the
  board's `layers` gives a `rules` warning.

### Changing the rules: set_rules

`set_rules` `{ rules, file? }` merges a part of this file into `rules.yaml` as one change the human
can undo: objects merge key by key, any other value (a list, a number) replaces what is there, and
`null` removes a key. The result is checked exactly as a build reads the file; a refused value
leaves the file as it was and the answer gives the schema's reason
(`rules.yaml was not changed: netClasses.power.trackWidth: "wide" is not a positive length …`).

- A power class: `{ "netClasses": { "power": { "nets": ["GND", "V5"], "trackWidth": 0.5 } } }`.
  The answer: `Change c0012: rules.yaml netClasses = …`, then `GND, V5 are class power: 0.5 mm
  tracks, 0.2 mm clearance; 3 existing tracks are narrower: unroute and autoroute GND, V5`. Set the
  classes before `autoroute`; afterwards, `unroute` and `autoroute` the nets it names.
- Four layers: `{ "fabrication": { "profile": "jlcpcb-4layer" } }`, then `fit_board` `{ file,
  layers: 4 }` gives the board its inner layers `inner1` and `inner2` (the answer says so when the
  profile and the board disagree).
- A clearance: `{ "fabrication": { "minClearance": 0.15 } }`, or a class's `clearance`.
- A pick-and-place rotation for one library part:
  `{ "fabrication": { "placementRotations": { "parts": { "MCP2515": 270 } } } }`.
- `file` names the circuit the answer reports on; with one circuit in the project it is that one.

`project_status` shows the rules in force in one line:
`Rules: jlcpcb-2layer (2 layers); default tracks 0.25 mm, clearance 0.2 mm; class power 0.5/0.2 mm: GND, V5`.

The `usb-c-ldo` example keeps one class: `power` for `VBUS`, `V3_3` and `GND`, with a 0.4 mm
track width and 0.2 mm clearance. It names no profile, so the default applies.

## Pairs, matched lengths and impedance

The router does not route pairs together and does not tune lengths: copperflow knows the classes and checks
them, and the tracks are yours to route. Calculated impedance is an estimate (about 1 % for a single line,
about 10 % for a pair, solder mask not counted): for a controlled impedance order, ask the board maker for
their stack and widths.

```yaml
fabrication:
  boardThickness: 1.6     # the profile's stack; each may be overridden
  permittivity: 4.6
  copperThickness: 0.035
  solderMask: true
  dielectricHeight: 1.53  # under an outer track; on 2 layers the board minus its two coppers when left out
netClasses:
  can:
    nets: [CANH, CANL]
    pair: by-name           # or a list: [[CANH, CANL]]
    differentialImpedance: 120
    gap: 0.2                # the track width then comes from the impedance
    maxSkew: 2
    minCoupled: 80          # percent of the pair's length side by side; 80 when left out
  addr:
    nets: ["A?"]
    matchGroup: addr
    maxSpread: 1
    maxLength: 60
    impedance: 50           # single line
```

- `pair: by-name` pairs names ending in `_P`/`_N`, `+`/`-`, `DP`/`DM` and `H`/`L` (CANH/CANL) within the class.
- When `impedance` or `differentialImpedance` is given and `trackWidth` is not, the width (and a pair's gap, at
  twice the profile's smallest gap unless `gap` is set) come from the stack; `copper_summary` says so. A target
  the board cannot make (a gap or width under the profile's smallest) is a `rules` warning that says what it needs.
- The `jlcpcb-4layer` profile has no `dielectricHeight`: set it to calculate there.
- A length runs pad to pad along the joined copper, the farthest two pads of the net; a via adds the board's thickness.

To work with a pair: declare the class, route the two nets by hand with `route_track` side by side at the class's
width and gap (or let `autoroute` route them and read the checks), read `check_circuit` and `copper_summary`, and
fix a finding by re-routing. `copperflow impedance --single 50 --pair 90` prints the calculation for the project.

## What the checks report

`copperflow check`, the agent's `check_circuit` and the Studio Checks panel (the `\` key) show the
same list. Errors come first, then warnings. Each violation has a code, an id, the items involved and a
position. Anything a check cannot evaluate is reported as `unchecked`, never silently passed.

| Code | Severity | Meaning |
|------|----------|---------|
| `pin-unconnected` | error for power-in, ground and input pins; warning for others | A pin shares its net with no other pin. A pin alone on a named net gets this and `single-pin-net`. |
| `nc-connected` | error | A pin marked no-connect is wired to other pins. |
| `output-conflict` | error | Several outputs drive one net. |
| `no-power-source` | warning | A net has power inputs but no power output, connector, pin header or battery pin, is not a global net, and reaches none through up to three series resistors, diodes, inductors, fuses or switches. |
| `single-pin-net` | warning | A named net has only one pin. |
| `crystal-pads` | error | A crystal on a four-pad footprint has its second end on pin2 (its lid) and nothing on pin3: the crystal would be open on every board. |
| `case-size` | warning | An electrolytic capacitor's capacitance and `voltageRating` are made in a larger or smaller can (in a general-purpose series' table) than its radial footprint is for. |
| `lead-spacing` | warning | A radial electrolytic footprint's lead spacing is not the one makers set for its can diameter (5 mm: 2, 6.3: 2.5, 8: 3.5, 10 and 12.5: 5, 16 and 18: 7.5, 20 and 22: 10, 25: 12.5). |
| `clearance` | error | Copper of two pads of different nets is closer than the larger clearance of their classes. |
| `board-edge` | error | A pad or its hole is closer to the board edge than `boardEdgeClearance`, or outside the board. |
| `drill-size` | error | A drill is below `minDrill`. |
| `annular-ring` | error | The copper ring around a drill is below `minAnnularRing`. |
| `hole-to-hole` | error | Two holes are closer than `minHoleToHole`. |
| `copper-hole` | error | Copper (a pad, track, via or pour fill) is closer to a non-plated `<hole>` than `boardEdgeClearance`. |
| `hole-off-board` | error | A non-plated `<hole>` is not wholly inside the board outline less `boardEdgeClearance` (off the board or across its edge); the export refuses it. |
| `pour-floating` | warning | A copper pour's fill joins no pad of its net. |
| `pour-sparse` | warning | A copper pour joins fewer than half of its net's pads (and its net's other pours do not make up the half): a pour joins only the pads on its layer and through pads, so put it on the layer the parts sit on. |
| `track-current` | warning | A net carries a current (a port's `carries`, or its class's `current`) and has tracks narrower than IPC-2221 asks for it: see "Trace width for current". |
| `pour-current` | warning | A copper pour on a net that carries a current narrows below the width that current needs between the pads, tracks and vias it joins, or joins a pad through spokes too thin together: see "Trace width for current". |
| `pour-empty` | warning | A copper pour has no copper: a pour of another net filled first (higher priority, or equal and earlier) took its area, or what is left touches none of its net's copper. |
| `courtyard-overlap` | error | Two part courtyards overlap. |
| `keepout` | error | A part lies inside a keep-out area. |
| `outside-board` | warning | A part is not inside the board outline. |
| `silk-on-pad` | warning | Silkscreen lies on a pad, closer than `minSilkToPad`; or a designator covers pads or another designator (the same findings, in the same words, as `export_fabrication`'s warnings: move it with `pcbNameAt` or move the part); or a `<silkscreentext>` or silkscreen `<boardgraphic>` lies on an exposed pad, a drill or a `<hole>` (move it). |
| `silk-off-board` | warning | A `<silkscreentext>`'s or silkscreen `<boardgraphic>`'s ink runs past the board outline, where the board house clips it: move it inside or shorten it. |
| `drawing-width` | warning | A `<boardgraphic>` on copper has lines narrower than `minTrackWidth`; the message names the thinnest. Thin parts of its filled shapes are not measured. |
| `silk-too-thin` | warning | A silkscreen `<boardgraphic>` has lines thinner than about 0.15 mm, which a board house may not print: the message names the thinnest; give a larger width or thicker lines. |
| `unplaced` | warning | Parts still on automatic placement. |
| `unrouted` | warning | Connections are not routed yet. With pours it also says how many more connections the pours make (those need no track), the same number `autoroute` leaves out of its total. |
| `pair-skew` | warning | The two nets of a pair differ in length by more than `maxSkew`. |
| `pair-apart` | warning | Less of a pair's length than `minCoupled` (80 %) runs within twice its gap of the other on one layer. |
| `pair-gap` | warning | Where a pair runs side by side, its gap is off the class's `gap`: how long and from where. |
| `pair-vias` | warning | The two nets of a pair have a different number of vias. |
| `net-length` | warning | A net is longer than its class's `maxLength`. |
| `match-spread` | warning | The nets of a `matchGroup` differ in length by more than `maxSpread`. |
| `impedance-width` | warning | A track of an impedance or pair class is wider than its class's width (narrower is `track-width`). |
| `unchecked` | warning | A check could not run: an unknown pad shape, no usable board outline, a part with no position, or a duplicate violation id. |

Rules the checks follow:

- A value exactly at a limit passes. Comparisons allow a tolerance of 1e-6 mm.
- Pads of one part with the same number or pin are one conductor and are not checked against each other.
- `power_out` pins of one part on one net count as one source, so they are not an `output-conflict`.
- With no usable board outline, the edge and outside-board checks do not run, and an `unchecked`
  warning says so.
- Copper checks (track width, track clearance, vias, pours) run with the others: `check_circuit` with filter
  `copper` lists them, and `copper_summary` counts them by rule. `unrouted` is the reminder that copper is missing.
