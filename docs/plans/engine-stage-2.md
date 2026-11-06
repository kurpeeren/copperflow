# Engine stage 2 (rules and checks): implementation plan

> Work through the tasks in order. Each step is a checkbox; tick it when its check passes.
> Read `docs/engine-design.md` first (sections 9, 11 and 12, and "Stages → 2"). This plan argues
> from it.

**Goal:** A project can state its fabrication limits and net classes in `rules.yaml`. The engine
then checks every build with electrical rule checks (ERC) and placement rule checks (DRC), and the
Studio, `copperflow check` and the MCP `check_circuit` all report the same violations. `check` no
longer runs tscircuit.

**Architecture:**
- `src/engine/rules/` reads `rules.yaml` into a typed `Rules`, with built-in fabrication profiles.
- `src/engine/checks/` runs ERC on the circuit and DRC on the PCB layout. It uses a small grid
  index and exact clearances between convex pad shapes.
- `buildDesign` adds `rules` and `violations` to the `Design`.
- The Studio draws violation markers and lists them in a bottom panel.
- Copper checks (tracks, vias, zones) arrive with copper in stage 4. Until then unrouted
  connections are one warning.

**Tech stack:** TypeScript (ESM, Node ≥22), zod and yaml (already used), vitest, React for the
Studio. No new runtime dependency.

**Spec:** `docs/engine-design.md`.

## Global constraints

- Node.js 22+, Windows, macOS and Linux. No network at run time.
- Apache 2.0. No GPL code (KiCad, Freerouting, gerbv, Falstad): behaviour only.
- Everything in the repository is in English.
- Commit messages are one short plain-English line, with no `type:` prefix and no attribution
  lines.
- The Studio never shows the word "tscircuit".
- Dependencies are pinned to exact versions.
- Studio code imports `src/engine/` with `import type` only, except `src/engine/symbols/`.
- Existing behaviour stays:
  - editable subset, locks and marks, history and undo;
  - the MCP safety rules: no unlock and no verify tool;
  - human-only part verification.
- Tests come first. `npm test` and `npm run typecheck` pass after every task, and coverage stays
  at 80% or more.
- Source files stay under 800 lines and functions under about 50 lines. Build new objects rather
  than mutating.
- Units: PCB lengths are in mm, y up, angles in degrees counter-clockwise. `rules.yaml` accepts
  numbers (mm) or strings with a unit (`"0.2mm"`, `"8mil"`), read through
  `src/engine/units.ts` `parseLength`.
- "Anything a check cannot evaluate is a violation, not a pass" (spec, section 9).
- Each violation has a stable id, a severity, a position and the items involved (spec,
  section 9).
- A full check of a 200-part board finishes in under a second (spec, section 9).

## Review focus

1. **`rules.yaml` is half-written while the Studio is open** (a syntax error, a wrong type).
   - Expected: one `rules` error diagnostic with the file and line. The build still finishes using
     the built-in defaults, and nothing crashes.
   - Owner: Task 2.
2. **A net matches two net classes** (the patterns overlap).
   - Expected: one `net-class-conflict` error naming both classes. The net uses the class written
     first.
   - Owner: Task 2.
3. **Pads of the same net touch or overlap**: USB-C shell tabs, multi-pad pins, a thermal pad and
   its pin.
   - Expected: no clearance violation.
   - Owner: Task 5.
4. **A circuit has no `<board>`.**
   - Expected: edge and outside-board checks become one `unchecked` warning ("no board outline").
     They are not skipped silently.
   - Owner: Task 6.
5. **A through-hole pad sits near an SMD pad on the opposite side.**
   - Expected: through pads take part on both copper layers; a top SMD pad never clashes with a
     bottom SMD pad.
   - Owner: Task 5.

---

### Task 1: Speed tests measure CPU time

The 200-part speed test fails under full-suite load because it measures wall time while other
test workers run.

**Files:**
- Modify: `test/engine/performance.test.ts`
- Create: `test/helpers/cpu-time.ts`

**Interfaces:**
- Produces:
  ```ts
  export function cpuMedianMs(run: () => void, times: number): number // median of process.cpuUsage() user+system deltas, in ms
  ```

- [ ] **Step 1:** Write `test/helpers/cpu-time.test.ts`:
  - `cpuMedianMs(() => {}, 5) < 5`;
  - a loop of about 20 ms of arithmetic returns a value between 5 and 200.
- [ ] **Step 2:** Run `npx vitest run test/helpers/cpu-time.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3:** Implement `cpuMedianMs`. In the performance test, replace the wall-clock median with
  it. Keep the 300 ms budget and keep printing the median.
- [ ] **Step 4:** Run `npm test` three times in a row. Expected: PASS each time.
  - If `test/studio.test.ts` fails in any run, find the cause and fix it in this task. Name the
    cause in the report.
- [ ] **Step 5:** Commit: `Speed tests measure CPU time, not wall time`.

---

### Task 2: `rules.yaml` and net classes

**Files:**
- Create: `src/engine/rules/schema.ts`, `src/engine/rules/profiles.ts`, `src/engine/rules/load.ts`,
  `src/engine/rules/classes.ts`
- Modify:
  - `src/engine/design.ts`: add `rules` to `Design`.
  - `src/engine/engine.ts`: collect `rules.yaml`.
  - `src/engine/project-files.ts`: export a `RULES_FILE` pattern.
  - `src/studio/live.ts`: rebuild when `rules.yaml` changes.
- Test: `test/engine/rules.test.ts`

**Interfaces:**
- Consumes: `parseLength` (`src/engine/units.ts`), `diagnostic` (`src/engine/diagnostics.ts`),
  `Net` and `Circuit` (`src/engine/model.ts`).
- Produces:
  ```ts
  // schema.ts — the parsed, resolved form; every length in mm
  export interface FabricationProfile { name: string; source: string; copperLayers: 2 | 4; minTrackWidth: number; minClearance: number; minDrill: number; minAnnularRing: number; boardEdgeClearance: number; minHoleToHole: number; minSilkToPad: number }
  export interface NetClass { name: string; trackWidth: number; clearance: number; via: { drill: number; diameter: number }; patterns: string[] }
  export interface Rules { fabrication: FabricationProfile; classes: NetClass[]; classClearance: { a: string; b: string; clearance: number }[]; globalNets: string[]; file?: string }
  // profiles.ts
  export const PROFILES: Readonly<Record<string, FabricationProfile>> // "jlcpcb-2layer" (default), "jlcpcb-4layer"
  export const DEFAULT_CLASS: NetClass // name "default"
  // load.ts
  export function loadRules(files: Readonly<Record<string, string>>): { rules: Rules; diagnostics: Diagnostic[] }
  // classes.ts
  export function classOfNet(rules: Rules, net: Net): string // class name, "default" when none matches
  export function netClasses(rules: Rules, nets: readonly Net[]): { byNet: Map<string, string>; diagnostics: Diagnostic[] }
  export function requiredClearance(rules: Rules, classA: string, classB: string): number
  ```

**The file format** (document it in `skills/copperflow/references/design-rules.md`):

```yaml
fabrication:
  profile: jlcpcb-2layer    # a built-in profile; optional, this is the default
  minClearance: 0.15        # any field overrides the profile
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

**Decisions:**
- The file is `rules.yaml` at the project root. When it is missing, use the default profile and the
  default class.
- **Built-in profiles.** `PROFILES` holds JLCPCB's published standard capabilities for 2- and
  4-layer boards. The `source` field names the page, its URL and the date read. Never write a value
  without a source.
- **The default class.** `DEFAULT_CLASS` is copperflow's own conservative choice, above the
  profile minimums: track 0.25 mm, clearance 0.2 mm, via drill 0.3 mm and diameter 0.6 mm. A class
  field left out takes the default class's value.
- **Patterns** match a net's names (`Net.names`) with `*` and `?`, case-sensitive.
- **Errors.**
  - An unnamed net belongs to no class unless a pattern is `*`.
  - A net that matches two classes gets one `net-class-conflict` error naming both classes, and it
    uses the class written first.
  - A pattern that matches no net is a `rules` warning.
- **`requiredClearance(a, b)`** is the largest of: the two classes' clearances, the
  `classClearance` entry for the pair in either order, and `fabrication.minClearance`.
- **Diagnostics.** YAML and schema errors become `rules` error diagnostics with `file:line` where
  the parser gives it, and the defaults are used. Unknown keys are errors, because the schema is
  strict. An unknown profile name is an error.
- **Collection.** `Engine` collects `rules.yaml` together with footprint files, and the Studio
  rebuilds when it changes.
- **Design.** `buildDesign` calls `loadRules` and `netClasses`. It puts `rules` on the `Design`
  and appends their diagnostics.

- [ ] **Step 1: Write the failing tests** in `test/engine/rules.test.ts`:
  - with no file, `loadRules({}).rules.fabrication.name === "jlcpcb-2layer"` and `classes` is empty;
  - `profile: jlcpcb-4layer` and `minClearance: "6mil"` give `copperLayers 4` and `minClearance` ≈ 0.1524;
  - a class without `clearance` takes 0.2;
  - `classOfNet` matches `V*` to `net.V3_3` and gives `"default"` for an unmatched net;
  - two classes matching `GND` give one `net-class-conflict` error, and GND uses the first class;
  - `requiredClearance(rules, "field", "default") === 2.5`, in either argument order;
  - a YAML syntax error gives one `rules` error whose message contains `rules.yaml:` and a line
    number, and the default rules are used;
  - an unknown key gives a `rules` error;
  - `buildDesign` on a project with `rules.yaml` exposes `design.rules.classes`;
  - `collectProjectFiles` with the engine's include pattern returns `rules.yaml`;
  - a `live.test.ts` case: editing `rules.yaml` rebuilds.
- [ ] **Step 2:** Run `npx vitest run test/engine/rules.test.ts test/live.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement to the interfaces and decisions. The schema is zod with `.strict()`;
  lengths go through `parseLength`.
- [ ] **Step 4:** Run the same command, then `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `Projects can state fabrication limits and net classes in rules.yaml`.

---

### Task 3: Check geometry and a grid index

**Files:**
- Create: `src/engine/checks/geometry.ts`, `src/engine/checks/grid-index.ts`
- Test: `test/engine/check-geometry.test.ts`

**Interfaces:**
- Consumes: `WorldPad` (`src/engine/pcb.ts`) and `Point`.
- Produces:
  ```ts
  // geometry.ts — every shape is a convex core (a point, a segment or a convex polygon) grown by a radius
  export interface Shape { core: Point[]; radius: number }
  export function padShape(pad: WorldPad): Shape | undefined   // undefined for a shape it cannot model
  export function drillShape(pad: WorldPad): Shape | undefined // the hole, or undefined when there is none
  export function shapeDistance(a: Shape, b: Shape): number    // edge-to-edge gap; negative when they overlap
  export function closestPoints(a: Shape, b: Shape): [Point, Point]
  export function shapeToSegmentDistance(a: Shape, p: Point, q: Point): number
  export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean
  export function polygonsOverlap(a: readonly Point[], b: readonly Point[]): boolean // positive-area overlap only; touching is not overlap
  export function bounds(shape: Shape): { minX: number; minY: number; maxX: number; maxY: number }
  // grid-index.ts
  export class GridIndex<T> { constructor(cell: number); insert(item: T, box: Box): void; query(box: Box): T[] } // no duplicates in query results
  ```

**Decisions:**
- **Pad shapes**, transformed by the pad's rotation and position:
  - `rect`: a 4-point polygon, radius 0.
  - `roundrect`: the rectangle shrunk by `cornerRadius` on each side, plus radius = `cornerRadius`.
  - `circle`: one point, radius = width/2.
  - `oval`: a segment along the long axis, radius = short side/2.
- **Drills** use the same rules as pads: round (one point) or slot (a segment).
- **`shapeDistance`** is the distance between the two cores minus both radii.
  - Core distance is 0 when one core is inside the other or they intersect.
  - Otherwise it is the minimum segment-to-segment distance over their edges. A point counts as a
    zero-length segment.
- **`GridIndex`** is a uniform grid; the cell size is a constructor argument. Use 2 mm for pads.

- [ ] **Step 1: Write the failing tests:**
  - two 1×1 rects whose centres are 3 mm apart → 2;
  - a circle (r 0.5) and a rect edge 1 mm from its centre → 0.5;
  - overlapping shapes → a negative distance;
  - an oval rotated by 90° gives the same gap as the equivalent capsule;
  - a roundrect corner keeps a gap larger than the plain rect's at 45°;
  - `polygonsOverlap` of two squares sharing an edge is false, and with 0.1 mm overlap is true;
  - `GridIndex.query` returns an item spanning four cells once;
  - `padShape` of a pad with an unknown shape string is undefined.
- [ ] **Step 2:** Run `npx vitest run test/engine/check-geometry.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. These modules are pure and import only types.
- [ ] **Step 4:** Run it again, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `Exact clearances between pad shapes and a grid index for checks`.

---

### Task 4: Keepouts on the board

**Files:**
- Modify:
  - `src/engine/model.ts`: add `Keepout`, and `Board.keepouts`.
  - `src/engine/board.ts` and `src/engine/elaborate.ts`: read `<keepout>`, and remove `keepout`
    from the later-stage set.
  - `studio/src/pcb/pcb-draw.ts`: draw keepouts.
- Test: `test/engine/elaborate.test.ts`, `test/pcb-draw.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Keepout { id: string; outline: Point[]; layers: "top" | "bottom" | "all"; source: SourceRef } // id "keepout:<n>" in source order
  export interface Board { /* existing fields */ keepouts: Keepout[] }
  ```

**Decisions:**
- **Shape.** `<keepout>` takes either `pcbX`/`pcbY`/`width`/`height` (a rectangle centred on the
  point, with group offsets added), or `outline` (a list of points). `layers` is `top`, `bottom`
  or `all`; the default is `all`.
- **No board.** A keepout without a `<board>` is a `bad-value` warning, and the keepout is ignored.
- **What it covers.** In this stage a keepout keeps pads and courtyards out. Copper joins in
  stage 4.
- **Drawing.** The PCB renderer draws a keepout as a hatched outline, in a new `PALETTE.keepout`
  colour.

- [ ] **Step 1: Write the failing tests:**
  - `<keepout pcbX={5} pcbY={0} width={4} height={2} />` gives a rectangle outline with x from 3 to 7;
  - `layers="top"` is kept;
  - a keepout inside `<group pcbX={10}>` is shifted by 10;
  - no `unsupported-element` warning for `<keepout>` any more;
  - `drawPcb` strokes the keepout in `PALETTE.keepout`.
- [ ] **Step 2:** Run `npx vitest run test/engine/elaborate.test.ts test/pcb-draw.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Boards can have keepout regions`.

---

### Task 5: DRC on pads and holes

**Files:**
- Create:
  - `src/engine/checks/violation.ts`
  - `src/engine/checks/drc-pads.ts`
- Test: `test/engine/drc-pads.test.ts`

**Interfaces:**
- Consumes:
  - Task 2: `Rules`, `requiredClearance`, `netClasses().byNet`.
  - Task 3: `padShape`, `drillShape`, `shapeDistance`, `closestPoints`, `shapeToSegmentDistance`, `GridIndex`.
  - `PcbLayout`.
- Produces:
  ```ts
  // violation.ts
  export interface Violation { id: string; code: string; severity: Severity; message: string; items: string[]; view: "pcb" | "schematic"; at?: Point }
  export function violation(code: string, severity: Severity, message: string, items: readonly string[], view: "pcb" | "schematic", at?: Point): Violation // items sorted naturally; id = `${code}:${items.join(",")}`
  // drc-pads.ts
  export function padChecks(layout: PcbLayout, rules: Rules, classOf: (net: string | undefined) => string): Violation[]
  ```

**Checks and their messages.** Distances print with 3 decimals in mm. Items are pad ids, or
component ids where noted.

| Code | Severity | Rule |
|---|---|---|
| `clearance` | error | Two pads share a copper layer and their nets differ (a pad without a net differs from everything), and `shapeDistance` < `requiredClearance(classA, classB)`. `at` is the midpoint of `closestPoints`. Message: `R1#1 and R2#2 are 0.120 mm apart; power–default needs 0.300 mm`. |
| `board-edge` | error | A pad or drill is closer than `fabrication.boardEdgeClearance` to an outline edge, or lies outside the outline. |
| `drill-size` | error | Drill width < `minDrill`. |
| `annular-ring` | error | A through pad's (min(width, height) − drill width)/2 < `minAnnularRing`. |
| `hole-to-hole` | error | Two drills (any nets) are closer edge to edge than `minHoleToHole`. |
| `unchecked` | warning | `padShape` is undefined. Items: the pad. One violation per pad. |

**Decisions:**
- **Layer sharing.** A `top` pad shares copper with `top` and `through` pads, a `bottom` pad with
  `bottom` and `through` pads, and a `through` pad with all three.
- **Pairs.** Each pair is checked once. The board-edge check is skipped when there is no board;
  Task 6 reports that.

- [ ] **Step 1: Write the failing tests.** Build designs with `buildDesign` from small circuits with
  placed parts.
  - two 0603 resistors 0.1 mm apart on different nets → one `clearance` error whose items are
    the two closest pads;
  - the same pads on one net → none;
  - a top SMD pad over a bottom SMD pad → none;
  - a through pad near a bottom SMD pad on another net → `clearance`;
  - with a `power` class at 0.3 mm on GND, two pads 0.25 mm apart (GND and another net) → `clearance` whose message says `0.300`;
  - a part whose pad crosses the board edge → `board-edge`;
  - a footprint file with drill 0.2 → `drill-size`;
  - a through pad with a 0.05 mm ring → `annular-ring`;
  - two drills 0.3 mm apart → `hole-to-hole`;
  - violation ids are stable across two builds;
  - the USB-C example → no `clearance` among J1's shell pads (same net).
- [ ] **Step 2:** Run `npx vitest run test/engine/drc-pads.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Index pads in a `GridIndex`. For each pad, query its bounds grown by
  the largest clearance in the rules.
- [ ] **Step 4:** Run it again, then `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Placement checks for pad clearance, board edge and holes`.

---

### Task 6: DRC on parts

**Files:**
- Create: `src/engine/checks/drc-parts.ts`
- Test: `test/engine/drc-parts.test.ts`

**Interfaces:**
- Consumes: `Violation`, `violation` (Task 5); `polygonsOverlap`, `pointInPolygon`,
  `shapeToSegmentDistance`, `padShape`, `GridIndex` (Task 3); `Board.keepouts` (Task 4);
  `PcbLayout`; `Rules`.
- Produces:
  ```ts
  export function partChecks(layout: PcbLayout, rules: Rules): Violation[]
  ```

| Code | Severity | Rule |
|---|---|---|
| `courtyard-overlap` | error | The courtyards of two parts on the same side overlap (`polygonsOverlap`). Items: the two component ids. |
| `outside-board` | warning | A part's courtyard is not inside the board outline. |
| `keepout` | error | A pad or courtyard on a keepout's layers overlaps the keepout. Items: the component and the keepout id. |
| `silk-on-pad` | warning | A silkscreen segment is closer than `minSilkToPad` to an exposed pad on the same side. Items: the component and the pad. |
| `unplaced` | warning | One violation listing every auto-placed part. Items: the parts. `at`: the first part's position. This replaces the `auto-placed` diagnostic, so remove that one. |
| `unrouted` | warning | One violation, `N connections are not routed yet`, with N = `layout.ratsnest.length`, when N > 0. No items. Stage 4 turns this into one error per connection. |
| `unchecked` | warning | One violation, `no board outline: edge and outside-board checks were not run`, when `layout.board` is undefined. |

- [ ] **Step 1: Write the failing tests**, one per row, each with a minimal circuit:
  - two overlapping 0603 courtyards → `courtyard-overlap`;
  - one on top and one on the bottom → none;
  - a part beyond the outline → `outside-board`;
  - a pad inside a `top` keepout → `keepout`;
  - the same part on the bottom with a `top` keepout → none;
  - auto-placed parts → one `unplaced` listing them, and no `auto-placed` diagnostic;
  - the example board → one `unrouted` warning with N = its ratsnest length;
  - no `<board>` → the `unchecked` warning.
- [ ] **Step 2:** Run `npx vitest run test/engine/drc-parts.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again, then `npm test`. Fix any test that expected `auto-placed`.
  Expected: PASS.
- [ ] **Step 5:** Commit: `Placement checks for courtyards, board outline, keepouts and silkscreen`.

---

### Task 7: ERC

**Files:**
- Create: `src/engine/checks/erc.ts`
- Test: `test/engine/erc.test.ts`

**Interfaces:**
- Consumes: `Circuit`, `SchematicLayout` (for pin positions: `PlacedSymbol.pinEnds`), `Rules` (`globalNets`), `violation`.
- Produces:
  ```ts
  export function electricalChecks(circuit: Circuit, schematic: SchematicLayout, rules: Rules): Violation[]
  ```

| Code | Severity | Rule |
|---|---|---|
| `pin-unconnected` | error for `power_in`, `ground` and `input`; warning for `output`, `power_out`, `bidirectional` and `passive` | The pin is on no net, or on a net with no other pin. `no_connect` pins are exempt. Items: the pin. `at`: its schematic pin end. |
| `nc-connected` | error | A `no_connect` pin is on a net with another pin. |
| `output-conflict` | error | Two or more `output` or `power_out` pins are on one net. Items: those pins. |
| `no-power-source` | warning | A net has a `power_in` pin and none of the following: a `power_out` pin, a pin of a `connector`, `pinheader` or `battery`, or a name listed in `rules.globalNets`. Items: the net's power_in pins. |
| `single-pin-net` | warning | A named net has exactly one pin. Items: the net id. |

**Decisions:**
- All ERC violations have `view: "schematic"`.
- A pin that is unconnected only because the schematic has no symbol for it still gets its
  violation, without `at`.

- [ ] **Step 1: Write the failing tests:**
  - the LDO's `EN` left floating → `pin-unconnected` error on `U1.pin3`;
  - its `NC` pin wired → `nc-connected`;
  - two LDO `VOUT`s on one net → `output-conflict`;
  - a `power_in` pin on `net.VBUS` fed only by `J1` (a connector) → no `no-power-source`;
  - the same net fed only by a resistor → `no-power-source`;
  - after adding `VBUS` to `globalNets` → none;
  - `<trace from="R1.pin1" to="net.LONELY" />` → `single-pin-net`;
  - the migrated USB-C example → no ERC errors.
- [ ] **Step 2:** Run `npx vitest run test/engine/erc.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `Electrical rule checks for unconnected, conflicting and unpowered pins`.

---

### Task 8: Every build carries its violations

**Files:**
- Create: `src/engine/checks/index.ts`
- Modify: `src/engine/design.ts` (add `violations`), `src/engine/index.ts` (re-export the check types)
- Test: `test/engine/checks.test.ts`, `test/engine/performance.test.ts`

**Interfaces:**
- Consumes: `padChecks` (Task 5), `partChecks` (Task 6), `electricalChecks` (Task 7), `netClasses` (Task 2).
- Produces:
  ```ts
  export function checkDesign(circuit: Circuit, schematic: SchematicLayout, layout: PcbLayout, rules: Rules): Violation[] // ERC first, then DRC; sorted by severity, then code, then id
  export interface Design { /* existing fields */ rules: Rules; violations: Violation[] }
  ```

**Decisions:**
- **Order.** `buildDesign` runs the checks after layout.
- **Diagnostics stay separate.** They are about the code and the model; violations are about the
  design. The Studio, the CLI and MCP show both.
- **Duplicate ids.** Two violations with one id would be a bug. `checkDesign` keeps the first and
  adds an `unchecked` warning naming the id.
- **Speed.** A 200-part board checks in under 1 s of CPU time. The test budget is 3 s
  (`cpuMedianMs` from Task 1), and the test prints the median.
- **Full checks for now.** The spec asks for incremental checks. In this stage every build checks
  the whole design with the grid index, which the budget above shows is fast enough. If the median
  goes over 100 ms, say so in the report: incremental checking then becomes stage 3's first task.

- [ ] **Step 1: Write the failing tests:**
  - `buildDesign(...).violations` contains ERC and DRC violations, in the stated order;
  - `structuredClone(design)` still deep-equals the design;
  - the 200-part board's `checkDesign` CPU median is under 3000 ms.
- [ ] **Step 2:** Run `npx vitest run test/engine/checks.test.ts test/engine/performance.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again, then `npm test`. Expected: PASS. Report the median.
- [ ] **Step 5:** Commit: `Every build checks itself`.

---

### Task 9: `check` runs on the engine alone

**Files:**
- Modify: `src/core/check.ts` (rewrite), `src/cli-commands.ts`, `src/mcp/server.ts`, `src/core/index.ts`
- Delete: `src/core/footprint-file-issues.ts` and its test, `test/fixtures/fake-tsci.mjs` and every use of it
- Modify: `README.md`, `skills/copperflow/SKILL.md`, `skills/copperflow/references/design-rules.md`
- Test: `test/check.test.ts`, `test/cli.test.ts`, `test/mcp.test.ts`

**Interfaces:**
- Consumes: `Design.violations`, `Design.diagnostics`, `buildWith` (`src/core/design-source.ts`).
- Produces:
  ```ts
  export interface CheckResult { ok: boolean; errors: IssueGroup[]; warnings: IssueGroup[]; violations: Violation[]; diagnostics: Diagnostic[] }
  export async function checkCircuit(root: string, file: string, options?: { engine?: DesignSource }): Promise<CheckResult>
  export function formatCheck(file: string, result: CheckResult): string
  ```

**Decisions:**
- **Pass or fail.** `ok` is true when there is no error violation and no error diagnostic. The
  CLI exits with 1 when `ok` is false.
- **Groups.** Groups are built from both lists by code. Each group shows up to 3 messages, each
  with its position (`at x.xx, y.yy mm` or `at the schematic`).
- **No tscircuit.**
  - `tsci` is no longer run, and the `--tsci` option, `COPPERFLOW_TSCI`, `buildCommand` and
    `buildCircuit` are removed.
  - The CLI rejects `--tsci` with a message that names it.
- **MCP.** `check_circuit` returns `formatCheck`'s text, and its description says what is checked.
- **Docs.**
  - README: `check` runs copperflow's own ERC and placement DRC. Copper checks come with routing.
  - Skill: the agent runs `check_circuit` after edits and fixes errors before reporting success.
    `rules.yaml` is the place for net classes.

- [ ] **Step 1: Write the failing tests:**
  - `checkCircuit` on the example → `ok`, with an `unrouted` warning group;
  - a floating `EN` pin → not `ok`, with a `pin-unconnected` group whose message names `U1.pin3`;
  - `formatCheck` prints positions;
  - the CLI's `check` exits 1 for the failing circuit and 0 for the example;
  - `--tsci` is rejected;
  - MCP `check_circuit` returns the same text;
  - `git grep -n tsci -- src` finds nothing (run as a test with `execSync`, or as a step check).
- [ ] **Step 2:** Run `npx vitest run test/check.test.ts test/cli.test.ts test/mcp.test.ts`.
  Expected: FAIL.
- [ ] **Step 3:** Implement. Update the docs.
- [ ] **Step 4:** Run `npm test`, `npm run typecheck` and `npm run build`. Expected: PASS.
- [ ] **Step 5:** Commit: `Check runs copperflow's own rules and no longer needs tscircuit`.

---

### Task 10: The Studio shows violations

**Files:**
- Create: `studio/src/ChecksPanel.tsx`, `studio/src/checks-list.ts`
- Modify:
  - canvases: `studio/src/pcb/pcb-draw.ts` and `studio/src/pcb/schematic-draw.ts` (markers);
  - app shell: `studio/src/App.tsx` (bottom panel, `\` key, status pill), `studio/src/pcb/canvas-keys.ts`
    (`\`), `studio/src/Inspector.tsx` (counts), `studio/src/styles.css`.
- Test: `test/checks-list.test.ts`, `test/pcb-draw.test.ts`, `test/schematic-draw.test.ts`,
  `test/canvas-keys.test.ts`

**Interfaces:**
- Consumes: `Design.violations` and `Design.diagnostics` (type imports only); the shared highlight
  and selection state in `App`.
- Produces:
  ```ts
  // checks-list.ts
  export interface CheckRow { id: string; severity: Severity; code: string; message: string; items: string[]; view: "pcb" | "schematic" | "code"; at?: Point; part?: string }
  export function checkRows(design: Design): CheckRow[]          // violations, then diagnostics (view "code"), errors first
  export function checkGroups(rows: readonly CheckRow[]): { code: string; severity: Severity; rows: CheckRow[] }[]
  export function partOf(row: CheckRow): string | undefined      // the first item that names a component
  // PcbDrawOptions and SchematicDrawOptions gain: violations?: readonly { at: Point; severity: Severity; id: string }[]; activeViolation?: string
  ```

**Decisions:**
- **Bottom panel.** A bottom panel named **Checks**, under the canvas and between the left and
  right panels:
  - It lists the groups with their counts, then each group's rows: message, then items.
  - Clicking a row switches to its view, centres the camera on `at` when there is one, and
    selects `partOf(row)`. A `code` row selects the part named in its items, if any.
  - `\` toggles the panel, as in the editor map, and clicking the status pill opens it.
  - It starts closed. It opens by itself only when a build first reports an error after a clean
    build.
- **Markers.** On the canvas each violation with `at` draws a ring of 6 px screen radius: red
  `PALETTE.error` for errors, amber `PALETTE.warning` for warnings. The active violation is
  thicker. Markers are drawn above copper and below the editor layer.
- **Status pill and Inspector.** The status pill counts error violations plus error diagnostics.
  The Inspector's check list shows the same counts and points to the panel. It no longer
  duplicates the full list.
- **Empty state.** `No problems found.`

- [ ] **Step 1: Write the failing tests:**
  - `checkRows` puts errors first and maps diagnostics to view `code`;
  - `checkGroups` groups by code with counts;
  - `partOf` picks `R1` from `["R1#1", "R2#2"]`;
  - `drawPcb` with one error violation strokes a ring in `PALETTE.error`, and the schematic does the same;
  - `keyAction` maps `\` to `toggleBottomPanel` and ignores it in text fields.
- [ ] **Step 2:** Run the four test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep functions short, and split the panel into small components.
- [ ] **Step 4:** Run `npm test`, `npm run typecheck` and `npm run build`. Expected: PASS. Then, on a
  copy of the example, open the Studio and check:
  - the Checks panel lists `unrouted`;
  - an overlap made by dragging R1 onto R2 shows a red ring and a `courtyard-overlap` row;
  - clicking that row centres the camera and selects R1.
- [ ] **Step 5:** Commit: `Studio lists checks in a bottom panel and marks them on the canvas`.

---

### Task 11: Example rules and the guide

**Files:**
- Create: `examples/usb-c-ldo/rules.yaml`
- Modify: `skills/copperflow/references/design-rules.md`, `README.md`
- Test: `test/engine/example.test.ts`

**Decisions:**
- **The example's rules:** the default profile, plus one `power` class.
  - Nets: `VBUS`, `V3_3`, `GND`.
  - Values: `trackWidth` 0.4, which matches the example's 0.4 mm traces; `clearance` 0.2.
  - `globalNets: [GND, VBUS, V3_3]`.
- **The guide** (`design-rules.md`) explains the file format from Task 2, how classes are chosen,
  what each check code means and its severity, and that copper checks arrive with routing.
- **Placement fixes.** If the example then reports placement errors (for example J1's courtyard),
  list them in the report and leave the placement unchanged. The maintainer decides placement.

- [ ] **Step 1: Write the failing test.** The example builds with `rules.classes[0].name === "power"`
  and no `rules` diagnostics. Assert the exact list of its violation codes as found, and write that
  list in the report.
- [ ] **Step 2:** Run `npx vitest run test/engine/example.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add the file and the guide.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Example states its power net class and the guide explains the checks`.

---

## After stage 2

Stage 3 is next: blocks, instances and hierarchical sheets, and the I/O module benchmark. Write its
plan when this one is done.
