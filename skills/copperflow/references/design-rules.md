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
- The built-in profiles are JLCPCB's published standard capabilities in 1 oz copper; each profile's
  `source` names the page, its sections and the date it was read.
- A class field left out takes the default class's value: track 0.25 mm, clearance 0.2 mm, via drill
  0.3 mm and diameter 0.6 mm. These are copperflow's own conservative choice, above the profile minimums.
- Patterns are case-sensitive and match a net's names. `*` alone matches every net, named or not.
  An unnamed net is in no class otherwise.
- A net that matches two classes is a `net-class-conflict` error and uses the class written first.
  A pattern that matches no net is a `rules` warning. A problem in the file itself (a bad key, a bad
  length, invalid YAML) is a `rules` error with the file and line, and the default rules then apply.
- Two classes need the largest of their own clearances, their `classClearance` entry (in either
  order) and the profile's `minClearance`.
- `globalNets` lists nets that are supplied from outside the circuit, such as ground and supply rails. The
  `no-power-source` check treats a net with one of these names as having a source.
- Fabrication: start from a profile, then override single fields under `fabrication`. Without
  `profile`, `jlcpcb-2layer` is used.

The `usb-c-ldo` example keeps one class: `power` for `VBUS`, `V3_3` and `GND`, with a 0.4 mm
track width and 0.2 mm clearance. It names no profile, so the default applies.

## What the checks report

`copperflow check`, the agent's `check_circuit` and the Studio Checks panel (the `\` key) show the
same list. Errors come first, then warnings. Each violation has a code, an id, the items involved and a
position. Anything a check cannot evaluate is reported as `unchecked`, never silently passed.

| Code | Severity | Meaning |
|------|----------|---------|
| `pin-unconnected` | error for power-in, ground and input pins; warning for others | A pin shares its net with no other pin. A pin alone on a named net gets this and `single-pin-net`. |
| `nc-connected` | error | A pin marked no-connect is wired to other pins. |
| `output-conflict` | error | Several outputs drive one net. |
| `no-power-source` | warning | A net has power inputs but no power output, connector, pin header or battery pin, and is not a global net. |
| `single-pin-net` | warning | A named net has only one pin. |
| `clearance` | error | Copper of two pads of different nets is closer than the larger clearance of their classes. |
| `board-edge` | error | A pad or its hole is closer to the board edge than `boardEdgeClearance`, or outside the board. |
| `drill-size` | error | A drill is below `minDrill`. |
| `annular-ring` | error | The copper ring around a drill is below `minAnnularRing`. |
| `hole-to-hole` | error | Two holes are closer than `minHoleToHole`. |
| `courtyard-overlap` | error | Two part courtyards overlap. |
| `keepout` | error | A part lies inside a keep-out area. |
| `outside-board` | warning | A part is not inside the board outline. |
| `silk-on-pad` | warning | Silkscreen lies on a pad, closer than `minSilkToPad`. |
| `unplaced` | warning | Parts still on automatic placement. |
| `unrouted` | warning | Connections are not routed yet. |
| `unchecked` | warning | A check could not run: an unknown pad shape, no usable board outline, a part with no position, or a duplicate violation id. |

Rules the checks follow:

- A value exactly at a limit passes. Comparisons allow a tolerance of 1e-6 mm.
- Pads of one part with the same number or pin are one conductor and are not checked against each other.
- `power_out` pins of one part on one net count as one source, so they are not an `output-conflict`.
- With no usable board outline, the edge and outside-board checks do not run, and an `unchecked`
  warning says so.
- Copper checks (track width, track clearance, vias) are not run yet. They come with routing in a later
  stage; until then `unrouted` is the reminder that the copper is missing.
