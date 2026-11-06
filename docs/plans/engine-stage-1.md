# Engine stage 1 (engine core): implementation plan

> Work through the tasks in order. Each step is a checkbox; tick it when its check passes.
> Read `docs/engine-design.md` first: this plan implements its "Stages → 1. Engine core" and
> argues from it.

**Goal:** copperflow builds circuits with its own engine. It evaluates the TSX, builds a circuit
model with stable ids, generates footprints and symbols, lays out the schematic and the PCB, and
draws the ratsnest. The Studio, `bom` and `package` read that model. tscircuit is no longer used
for any of this; `copperflow check` keeps using it until stage 2.

**Architecture:** The engine lives in `src/engine/`, with one module per step, and runs in one
worker thread. The Studio server asks the worker for a `Design` and sends it to the browser, where
copperflow's renderers draw it. Nothing produces circuit JSON. The source analysis in `src/core/`
(editable subset, edits, locks, history) stays as it is.

**Tech stack:** TypeScript (ESM, Node ≥22), esbuild for TSX → JS, `node:vm` and
`node:worker_threads`, zod and yaml (already used), vitest, React for the Studio.

**Spec:** `docs/engine-design.md` (commit 59c1987).

## Global constraints

- Node.js 22+, Windows, macOS and Linux. No network at run time: no part or footprint lookups.
- Apache 2.0. Code may be ported, with attribution in NOTICE, only from packages that ship a
  permissive LICENSE file. tscircuit packages without a licence file and `@tscircuit/krt-wasm`
  are for ideas only. No GPL code (KiCad, Freerouting, gerbv, Falstad): behaviour only.
- Everything in the repository is in English.
- Commit messages are one short plain-English line, with no `type:` prefix and no attribution
  lines.
- The Studio never shows the word "tscircuit".
- Dependencies are pinned to exact versions in `package.json`, as today.
- Existing behaviour stays: the editable subset, locks and marks, history and undo, the MCP tools
  and their safety rules (no unlock or verify tool), and human-only part verification.
- Tests come first. `npm test` and `npm run typecheck` pass after every task. Coverage stays at
  80% or more (`vitest.config.ts` thresholds).
- Source files stay under 800 lines and functions under about 50 lines. New objects are built
  rather than mutated.
- Units: PCB lengths in millimetres; schematic lengths in today's schematic units. Both use y up
  and angles in degrees counter-clockwise.
- The engine never produces circuit JSON.

## Review focus

Inputs the spec implies but that are easy to leave untested, most likely to bite first. Each one
has its test in the task that owns the code.

1. **A circuit file with Windows line endings (CRLF).** Source offsets must still point at the
   element. Owner: Task 1.
2. **Two parts with the same name, for example from a `.map()` loop.** Report one
   `duplicate-name` error; draw both parts; nothing crashes. Owner: Task 2.
3. **A trace that names a pin that does not exist** (`R1.pin3`). Report an `unknown-pin` error
   that lists the real pins; every other net still builds. Owner: Task 2.
4. **A footprint string the engine cannot make yet** (`bga64`). The part still appears in the
   schematic and the BOM, with no pads and an error. Owners: Task 8 and Task 13.
5. **A syntax error in the middle of editing while the Studio is open.** The last good design
   stays on screen and the error is shown. Owner: Task 12.

---

### Task 1: Evaluate circuit code

**Files:**
- Create: `src/engine/model.ts` (only `SourceRef` for now; Task 2 adds the rest)
- Create: `src/engine/jsx-runtime.ts`
- Create: `src/engine/evaluate.ts`
- Modify: `package.json` (add `esbuild`, exact version, to `dependencies`)
- Test: `test/engine/evaluate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // model.ts
  export interface SourceRef { file: string; line: number; column: number; offset: number } // line and column 1-based
  // jsx-runtime.ts
  export const Fragment = "#fragment"
  export type ComponentFunction = (props: Record<string, unknown>) => unknown
  export interface CfElement {
    type: string | ComponentFunction
    props: Record<string, unknown> // without children
    children: unknown[] // flattened: arrays and fragments spliced in; null, undefined and booleans dropped
    source?: SourceRef
  }
  export function createRuntime(files: Readonly<Record<string, string>>): {
    jsx(type: CfElement["type"], props: Record<string, unknown>, key?: unknown): CfElement
    jsxs: same as jsx
    jsxDEV(type, props, key, isStatic, source?: { fileName: string; lineNumber: number; columnNumber: number }): CfElement
    Fragment: typeof Fragment
  }
  // evaluate.ts
  export class CircuitCodeError extends Error {} // message starts with "<file>:<line>:<column>: " when the place is known
  export interface Evaluated { root: CfElement; definedIn(fn: ComponentFunction): string | undefined } // project path of the module that exported fn
  export function evaluateCircuit(files: Readonly<Record<string, string>>, main: string): Evaluated
  ```

- [ ] **Step 1: Write the failing tests** in `test/engine/evaluate.test.ts`:

```ts
const board = (body: string) => `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`

test("evaluates the board and records where each element is written", () => {
  const text = board(`    <resistor name="R1" footprint="0402" />`)
  const { root } = evaluateCircuit({ "main.circuit.tsx": text }, "main.circuit.tsx")
  expect(root.type).toBe("board")
  const r1 = root.children[0] as CfElement
  expect(r1).toMatchObject({ type: "resistor", props: { name: "R1", footprint: "0402" } })
  expect(r1.source).toEqual({ file: "main.circuit.tsx", line: 3, column: 5, offset: text.indexOf("<resistor") })
})

test("offsets count CRLF line endings", () => {
  const text = board(`    <resistor name="R1" />`).replaceAll("\n", "\r\n")
  const { root } = evaluateCircuit({ "main.circuit.tsx": text }, "main.circuit.tsx")
  expect((root.children[0] as CfElement).source?.offset).toBe(text.indexOf("<resistor"))
})

test(".map() and imported constants produce elements", () => {
  const files = {
    "shared.ts": "export const COUNT = 3",
    "main.circuit.tsx": `import { COUNT } from "./shared"\n` + board(`{Array.from({ length: COUNT }, (_, i) => <resistor name={"R" + i} />)}`),
  }
  expect(evaluateCircuit(files, "main.circuit.tsx").root.children).toHaveLength(3)
})

test("function components are kept for the elaborator, with the module that defined them", () => {
  const files = {
    "parts/X/X.tsx": `export const X = (props: { name: string }) => <chip footprint="soic8" {...props} />`,
    "main.circuit.tsx": `import { X } from "./parts/X/X"\n` + board(`<X name="U1" />`),
  }
  const { root, definedIn } = evaluateCircuit(files, "main.circuit.tsx")
  const u1 = root.children[0] as CfElement
  expect(typeof u1.type).toBe("function")
  expect(definedIn(u1.type as ComponentFunction)).toBe("parts/X/X.tsx")
})

test("imports may name only project files and copperflow", () => {
  const files = { "main.circuit.tsx": `import React from "react"\n` + board("") }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/imports may name only project files and copperflow; "react" is not allowed/)
})

test("a relative import may not leave the project", () => {
  const files = { "main.circuit.tsx": `import x from "../secret"\n` + board("") }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/outside the project/)
})

test("syntax errors name the file, line and column", () => {
  const files = { "main.circuit.tsx": "export default () => <board>\n" }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/^main\.circuit\.tsx:\d+:\d+: /)
})

test("circuit code cannot reach Node", () => {
  const files = { "main.circuit.tsx": "export default () => { process.exit(1) }" }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/process is not defined/)
})

test("the default export must be a component or an element", () => {
  const files = { "main.circuit.tsx": "export default 42" }
  expect(() => evaluateCircuit(files, "main.circuit.tsx")).toThrow(/must export default a function that returns <board>/)
})
```

- [ ] **Step 2: Run them and see them fail.**
  Run `npx vitest run test/engine/evaluate.test.ts`. Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Implement.**
  - Transpile each file with esbuild's `transformSync`: `loader` from the extension, `format: "cjs"`,
    `jsx: "automatic"`, `jsxDev: true`, `jsxImportSource: "copperflow"`, and `sourcefile` set to
    the project path. Cache the output by path and text, keeping at most 500 entries.
  - Run each module through `vm.compileFunction(code, ["exports", "require", "module"], { filename, parsingContext })`.
    Use one fresh `vm.createContext({ console })` per evaluation, so there is no `process`, no
    Node `require` and no `fetch`.
  - `require` resolves:
    - `./` and `../` specifiers against the importing file, trying `""`, `.tsx`, `.ts`, `.jsx`,
      `.js`, `.json`, `/index.tsx`, `/index.ts`;
    - `copperflow`, `copperflow/jsx-runtime` and `copperflow/jsx-dev-runtime` to `createRuntime(files)`;
    - anything else to a `CircuitCodeError`.
    JSON files are parsed. Cycles behave as in CommonJS.
  - `jsxDEV` turns line and column into an offset with a per-file table of line starts. A `\r\n`
    counts as two characters.
  - `definedIn` comes from a `Map<Function, path>` filled from every module's exports after it
    runs.
  - When the default export is a function, call it with `{}`. It must return a `CfElement`.
  - esbuild errors carry `errors[0].location`. Turn them into the
    `<file>:<line>:<column>: <text>` message.

- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run test/engine/evaluate.test.ts`.
  Expected: PASS. Then run `npm run typecheck`. Expected: no errors.

- [ ] **Step 5: Commit.** Commit message: `Engine evaluates circuit code with its own JSX runtime`.

---

### Task 2: Elaborate the circuit model

**Files:**
- Modify: `src/engine/model.ts`
- Create: `src/engine/units.ts`, `src/engine/kinds.ts`, `src/engine/elaborate.ts`
- Test: `test/engine/units.test.ts`, `test/engine/elaborate.test.ts`

**Interfaces:**
- Consumes: `Evaluated`, `CfElement`, `SourceRef` (Task 1).
- Produces (in `model.ts`):
  ```ts
  export interface Point { x: number; y: number }
  export type Severity = "error" | "warning"
  export interface Diagnostic { code: string; severity: Severity; message: string; items: string[]; source?: SourceRef }
  export type PinType = "power_in" | "power_out" | "ground" | "input" | "output" | "bidirectional" | "passive" | "no_connect"
  export type Side = "left" | "right" | "top" | "bottom"
  export interface Pin { id: string; component: string; number: number; names: string[]; type: PinType } // id "R1.pin1"; names[0] is "pin<n>"
  export interface Component {
    id: string // the name, e.g. "R1"
    kind: string // the tag, e.g. "resistor" or "chip"
    value?: string
    footprint?: string
    mpn?: string
    supplierPartNumbers: Record<string, string[]>
    library?: string // parts/<id> folder when made by a library component
    pins: Pin[]
    pinSides: Record<number, Side>
    sch?: { x: number; y: number; rotation: number }
    pcb?: { x: number; y: number; rotation: number; side: "top" | "bottom" }
    props: Record<string, unknown> // evaluated props that are JSON values (functions dropped)
    source: SourceRef // the outermost element that produced it
  }
  export interface Net { id: string; names: string[]; pins: string[] } // named: "net.GND"; unnamed: "net:" + first pin id
  export interface Connection { id: string; from: string; to: string; width?: number; corners?: Point[]; source: SourceRef }
  export interface Board { outline: Point[]; layers: 2 | 4; thickness: number; schMaxTraceDistance?: number }
  export interface Circuit { file: string; components: Component[]; nets: Net[]; connections: Connection[]; board?: Board; diagnostics: Diagnostic[] }
  ```
  ```ts
  // units.ts
  export function parseLength(value: unknown): number | undefined // mm: 2.54 | "2.54" | "2.54mm" | "0.1in" | "100mil"
  export function parseAngle(value: unknown): number | undefined // degrees in [0, 360): 90 | "90deg" | -90 → 270
  // kinds.ts
  export interface KindInfo { prefix: string; valueProp?: string; pins: { number: number; names: string[] }[] | "from-props" }
  export const KINDS: Readonly<Record<string, KindInfo>>
  export function pinTypeFromAttributes(attributes: Record<string, unknown> | undefined): PinType
  // elaborate.ts
  export function elaborate(evaluated: Evaluated, file: string, options: { padCount(footprint: string): number | undefined }): Circuit
  ```

Pin names of the built-in kinds. These are decisions; record them in `kinds.ts` and in
`skills/copperflow/references/editable-subset.md`.

| Kind | Pins (number: names) |
|---|---|
| resistor, capacitor, inductor, fuse, crystal, switch | 1: pin1, left · 2: pin2, right |
| capacitor with `polarized` | 1: pin1, pos, anode · 2: pin2, neg, cathode |
| diode, led | 1: pin1, anode, pos · 2: pin2, cathode, neg |
| battery | 1: pin1, pos · 2: pin2, neg |
| potentiometer | 1: pin1 · 2: pin2, wiper · 3: pin3 |
| resonator | 1: pin1 · 2: pin2, gnd · 3: pin3 |
| pushbutton | 1–4: pin1–pin4 |
| testpoint | 1: pin1 |
| transistor (`type` npn or pnp) | 1: pin1, B, base · 2: pin2, E, emitter · 3: pin3, C, collector |
| mosfet | 1: pin1, G, gate · 2: pin2, S, source · 3: pin3, D, drain |
| pinheader | 1…pinCount: pin\<n> |
| chip, connector | from `pinLabels` (a name or a list of names per `pin<n>`), else `pinCount`, else `padCount(footprint)` |

Rules:
- A pin's names are `pin<n>` followed by its `pinLabels` names when `pinLabels` names it,
  otherwise by the kind's aliases from the table.
- `schRotation` is rounded to the nearest multiple of 90, with a `bad-value` warning when it was
  not one. `pcbRotation` may be any angle.
- Pin types come from `pinAttributes` through `pinTypeFromAttributes`, the inverse of
  `PIN_ATTRIBUTES` in `src/core/library.ts`. The default is `passive`.
- Selectors `.R1 > .pin1`, `R1.pin1` and `net.GND` resolve pins by any of their names.
- `<group>` adds its `pcbX`/`pcbY`/`schX`/`schY` to its children's positions.
- A part counts as placed when `pcbX` or `pcbY` is given; the missing coordinate is 0. The same
  holds for `schX`/`schY`.
- `layer="bottom"` sets `side: "bottom"`.
- `<board>` gives a rectangle `width × height`, centred on its own `pcbX`/`pcbY` (default 0), or
  its `outline` points. `layers` is 2 or 4, default 2; `thickness` defaults to 1.6.
- A function component is called with its props plus `children`. The component it returns gets
  the call site's `source` and `library = <id>` when `definedIn` is `parts/<id>/…`.
- A `connector` without `pinLabels`, `pinCount` or `footprint` (today's `standard="usb_c"`)
  gets no pins and an `unsupported-element` error.

Diagnostic codes: `missing-name`, `duplicate-name` (the second part gets id `<name>~2`),
`unknown-part`, `unknown-pin`, `bad-selector`, `bad-value`, `unsupported-element` (warning for
via, hole, keepout, copperpour, port and netlabel until their stage; error for an unknown tag),
`two-boards`, and `nets-joined` (warning, when one trace joins two named nets; the net keeps both
names, and its id uses the first name in sorted order).

- [ ] **Step 1: Write the failing tests.**

  `units.test.ts` covers:

  ```ts
  expect(parseLength("2.54mm")).toBe(2.54)
  expect(parseLength("0.1in")).toBeCloseTo(2.54)
  expect(parseLength("100mil")).toBeCloseTo(2.54)
  expect(parseLength(3)).toBe(3)
  expect(parseLength("wide")).toBeUndefined()
  expect(parseAngle(-90)).toBe(270)
  expect(parseAngle("90deg")).toBe(90)
  ```

  `elaborate.test.ts` evaluates a source with `evaluateCircuit` and calls
  `elaborate(evaluated, "main.circuit.tsx", { padCount: () => undefined })`. Its tests:

  - `pins of built-in kinds and pinLabels`: an LED without `pinLabels` has names
    `["pin1", "anode", "pos"]` and `["pin2", "cathode", "neg"]`. An LED with
    `pinLabels={{ pin1: "cathode", pin2: "anode" }}` has `["pin1", "cathode"]` and
    `["pin2", "anode"]`, and a trace from `LED1.anode` lands on `LED1.pin2`.
  - `named and unnamed nets`: from `R1.pin2 → net.GND`, `C1.pin2 → net.GND` and
    `C1.pin1 → .R1 > .pin1`, expect a net `{ id: "net.GND", names: ["GND"], pins: ["C1.pin2", "R1.pin2"] }`
    and a net with id `"net:C1.pin1"` whose pins are `["C1.pin1", "R1.pin1"]`. Pins are in
    natural sort order.
  - `duplicate names are reported once and both parts are kept`: from
    `{[1, 2].map(() => <resistor name="RX" />)}`, expect component ids `["RX", "RX~2"]` and
    exactly one diagnostic `{ code: "duplicate-name", severity: "error", items: ["RX"] }`.
  - `a mistyped pin is reported with the real pins`: from `<trace from="R1.pin3" to="net.GND" />`
    and `<trace from="R1.pin1" to="net.VCC" />`, expect a diagnostic whose message is
    `"R1 has no pin pin3 (pins: pin1, pin2)"`, and the net `net.VCC` still exists.
  - `group offsets add up`: a `<group pcbX={10}>` around `<resistor name="R1" pcbX={1} />` gives
    `pcb.x === 11`.
  - `library parts keep their call site`: with `parts/AP/AP.tsx` exporting a chip with
    `pinLabels` and `pinAttributes`, the component has `library: "AP"`,
    `source.file: "main.circuit.tsx"`, and the `VIN` pin has type `power_in`.
  - `unsupported elements are reported, not skipped`: `<via />` gives a warning with code
    `unsupported-element`.
  - `pinheader pins follow pinCount`: `pinCount={3}` gives pins `J1.pin1`…`J1.pin3`.

- [ ] **Step 2: Run them and see them fail.** Run
  `npx vitest run test/engine/units.test.ts test/engine/elaborate.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `units.ts`, `kinds.ts` and `elaborate.ts` to the interfaces and the
  table above. Merge nets with union-find over connection endpoints. Connection ids are
  `` `${from}|${to}` ``, with `#2`, `#3` and so on for repeats. `corners` come from
  `schematicRouteHints`. `width` comes from `thickness` or `width`, through `parseLength`.

- [ ] **Step 4: Run the tests and see them pass.** Run the same command. Expected: PASS. Run
  `npm run typecheck`. Expected: no errors.

- [ ] **Step 5: Commit.** Commit message: `Engine elaborates a circuit model with stable ids and nets`.

---

### Task 3: IPC-7351 land patterns for chip passives and SOD

**Files:**
- Create: `src/engine/footprints/types.ts`, `ipc7351.ts`, `parse.ts`, `chip.ts`, `sod.ts`, `outline.ts` (courtyard, silkscreen and body helpers), `index.ts`
- Test: `test/engine/footprints-chip.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type PadShape = "rect" | "roundrect" | "circle" | "oval"
  export interface Pad {
    number: string // pad "1" belongs to pin 1
    shape: PadShape
    x: number; y: number; width: number; height: number; rotation: number
    layers: "top" | "bottom" | "through" // footprints are made on "top"; Task 8 flips them for the bottom side
    drill?: { width: number; height: number } // through pads only; equal for a round hole
    cornerRadius?: number
  }
  export interface Footprint { name: string; pads: Pad[]; courtyard: Point[]; silkscreen: Point[][]; fabrication: Point[][]; origin: string }
  // ipc7351.ts
  export interface Range { min: number; max: number }
  export interface FilletGoals { toe: number; heel: number; side: number }
  export interface Tolerances { fabrication: number; placement: number }
  export function landPattern(lead: { span: Range; terminal: Range; width: Range }, goals: FilletGoals, tol: Tolerances): { Z: number; G: number; X: number }
  // index.ts
  export function generateFootprint(text: string, readFile?: (path: string) => string | undefined): Footprint | { error: string }
  export function padCount(text: string): number | undefined
  ```
  Footprint coordinates are in mm, origin at the part centre, y up, seen from the top, at
  rotation 0. `origin` names where the numbers come from, for example
  `"IPC-7351B nominal, EIA 0603"`.

Decisions:
- `landPattern` uses the IPC-7351B equations, with S computed by root-sum-square:
  - `CL = Lmax − Lmin`, `CT = Tmax − Tmin`, `CW = Wmax − Wmin`
  - `Smin = Lmin − 2·Tmax`, `Smax = Lmax − 2·Tmin`, `CS = Smax − Smin`
  - `CSrms = √(CL² + 2·CT²)`, `Smax' = Smax − (CS − CSrms)/2`
  - `Z = Lmin + 2·Jt + √(CL² + F² + P²)`
  - `G = Smax' − 2·Jh − √(CSrms² + F² + P²)`
  - `X = Wmin + 2·Js + √(CW² + F² + P²)`
- A two-terminal pad is `(Z − G)/2` wide and `X` high, centred at `x = ±(Z + G)/4`, with pad 1
  at negative x.
- Pad shape is `roundrect`, with a corner radius of 25% of the shorter side, at most 0.25 mm.
- Round Z and X up and G down to 0.01 mm.
- Courtyard: a rectangle around the pads and the body, plus 0.25 mm (nominal density), rounded
  up to 0.01 mm.
- Silkscreen keeps 0.15 mm away from pads. Chips get two lines along the body. SOD gets a
  cathode bar on the pad 2 side, because pin 2 is the cathode by Task 2's table.
- Families in this task:
  - `0201`, `0402`, `0603`, `0805`, `1206`, `1210`, `1812`, `2010`, `2512` (imperial codes);
  - `sod123`, `sod323`, `sod523`.
- Fillet goals, tolerances (F, P) and package dimensions are transcribed from IPC-7351B and the
  package standards (EIA, JEDEC). Each table in the code carries a comment naming its source
  (document, table and page). Use no value without a source.
- An unknown string gives `{ error: 'copperflow cannot make footprint "<text>" yet' }`.

- [ ] **Step 1: Write the failing tests.** The equation test uses invented inputs, so it checks
  the arithmetic:

```ts
test("landPattern follows the IPC-7351B equations", () => {
  const r = landPattern(
    { span: { min: 1.0, max: 1.2 }, terminal: { min: 0.2, max: 0.4 }, width: { min: 0.4, max: 0.6 } },
    { toe: 0.35, heel: 0, side: 0 },
    { fabrication: 0.1, placement: 0.05 },
  )
  expect(r.Z).toBeCloseTo(1.9291, 4)
  expect(r.G).toBeCloseTo(0.3092, 4)
  expect(r.X).toBeCloseTo(0.6291, 4)
})
```

  The other tests:
  - `published land patterns`: 0402, 0603, 0805, 1206 and SOD-123 each match a published
    nominal land pattern to within 0.05 mm (pad width, pad height, pad centre distance). The
    source is named in a comment above each case.
  - `pads never overlap and the courtyard holds them`: for every family, `G > 0`, and every pad
    corner lies at least 0.25 mm inside the courtyard.
  - `pad 1 is on the left`: `pads[0].number === "1"` and `pads[0].x < 0`.
  - `padCount("0603") === 2`, `padCount("sod123") === 2`.
  - `unknown strings are refused`:
    `expect(generateFootprint("bga64")).toEqual({ error: 'copperflow cannot make footprint "bga64" yet' })`.

- [ ] **Step 2: Run them and see them fail.** Run
  `npx vitest run test/engine/footprints-chip.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** the files above. `generateFootprint` caches results by text.

- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS. Then `npm run typecheck`.

- [ ] **Step 5: Commit.** Commit message: `IPC-7351 footprints for chip passives and SOD packages`.

---

### Task 4: Gull-wing, leadless and pin-row footprints

**Files:**
- Create: `src/engine/footprints/sot.ts`, `dual.ts` (SOIC, SOP, TSSOP), `quad.ts` (QFP, QFN), `pinrow.ts`
- Modify: `src/engine/footprints/parse.ts`, `index.ts`
- Modify: `src/engine/elaborate.ts` (a `pinheader` without `footprint` gets `pinrow<pinCount>_p<pitch>mm`; pitch defaults to 2.54)
- Test: `test/engine/footprints-ic.test.ts`

**Interfaces:**
- Consumes: `landPattern`, `Footprint`, `Pad` (Task 3).
- Produces: `generateFootprint` and `padCount` also accept:
  - `sot23`, `sot23_5`, `sot23_6`;
  - `soic<N>`, `sop<N>`, `tssop<N>`;
  - `qfp<N>`, `qfn<N>`;
  - `pinrow<N>`.

  Optional parameters: `_p<pitch>` (for example `_p0.5mm`), `_w<lead span>`, and for QFN `_ep`
  (an exposed pad numbered `N+1`).

Decisions:
- Pin numbering is counter-clockwise, seen from the top.
  - SOT-23 (3 pins): pad 1 bottom left, pad 2 bottom right, pad 3 top centre.
  - SOT-23-5 and SOT-23-6: pads 1–3 along the bottom from left to right, then the rest along the
    top from right to left.
  - Dual rows: pad 1 at the top of the left column; the left column runs top to bottom, then the
    right column bottom to top.
  - Quad packages: pad 1 at the top of the left side, then the bottom side from left to right,
    the right side from bottom to top, and the top side from right to left.
- Default pitches: SOIC and SOP 1.27 mm, TSSOP 0.65 mm. QFP and QFN body size and pitch come from
  a table keyed by pin count, with its JEDEC source cited.
- `pinrow<N>`:
  - through-hole pads along x, centred on the origin;
  - pitch from `_p`, default 2.54 mm;
  - drill 1.0 mm, pad diameter 1.7 mm;
  - pad 1 is `rect`, the others `circle`.
- Gull-wing and leadless fillet goals come from IPC-7351B, cited like Task 3's tables.

- [ ] **Step 1: Write the failing tests:**
  - `numbering goes counter-clockwise from pad 1`: for `sot23_5`, pads 1, 2, 3 have the same
    `y < 0` and rising `x`; pads 4 and 5 have `y > 0` and falling `x`. For `soic8`, pad 1 has
    the smallest `x` and the largest `y`, and pad 8 has the largest `x` and the largest `y`.
    For `qfp48`, pad 13 is the leftmost pad of the bottom side.
  - `pitch`: neighbouring pads of `soic8` are 1.27 mm apart; those of
    `tssop20` are 0.65 mm apart, and those of `qfn32_p0.5mm` 0.5 mm apart.
  - `published land patterns`: SOT-23-5, SOIC-8, TSSOP-20, QFP-48 and QFN-32 each match a cited
    published nominal pattern to within 0.05 mm.
  - `pinrow2 is a 2.54 mm header`:
    `generateFootprint("pinrow2_p2.54mm")` has pads at x = −1.27 and 1.27, `layers: "through"`,
    a drill width of 1.0, pad 1 `rect` and pad 2 `circle`.
  - `pinheaders get a pinrow footprint`: elaborating `<pinheader name="J2" pinCount={2} pitch="2.54mm" />`
    gives `footprint === "pinrow2_p2.54mm"`.
  - `padCount("qfn32_ep") === 33`.

- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run test/engine/footprints-ic.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the families to the decisions above.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS; typecheck clean.
- [ ] **Step 5: Commit.** Commit message: `Footprints for SOT, SOIC, TSSOP, QFP, QFN and pin rows`.

---

### Task 5: Footprint files for library parts

**Files:**
- Create: `src/engine/footprints/file.ts`
- Modify: `src/core/library.ts` (schema, hash, generator, checklist, `createPart` option)
- Modify: `src/mcp/server.ts` (`create_part` accepts `footprint_file`)
- Modify: `skills/copperflow/references/parts-library.md`
- Test: `test/engine/footprint-file.test.ts`, `test/library.test.ts`, `test/library-safety.test.ts`

**Interfaces:**
- Consumes: `Footprint`, `Pad` (Task 3).
- Produces:
  ```ts
  // footprints/file.ts
  export const FootprintFileSchema: z.ZodType<FootprintFile>
  export interface FootprintFile {
    pads: { number: string; shape: PadShape; x: number; y: number; width: number; height: number; rotation?: number; layers?: "top" | "through"; drill?: number | { width: number; height: number } }[]
    courtyard?: [number, number][]
    silkscreen?: [number, number][][]
    body?: [number, number][]
  }
  export function footprintFromFile(path: string, text: string): Footprint | { error: string }
  // library.ts
  export const FOOTPRINT_FILE = "footprint.yaml"
  export function contentHash(part: Part, footprintText?: string): string // unchanged result when footprintText is absent
  export function isVerified(part: Part, footprintText?: string): boolean
  export async function readFootprintText(root: string, id: string, part: Part): Promise<string | undefined>
  createPart(root, id, data, options: { replace?: boolean; footprintFile?: FootprintFile })
  ```

Decisions:
- `part.yaml` says `footprint: footprint.yaml`. The file sits in the part folder. The generated
  component writes `footprint={"parts/<id>/footprint.yaml"}`.
- `generateFootprint` reads a string that matches `^parts/[A-Za-z0-9._-]+/footprint\.yaml$`
  through its `readFile` argument and refuses any other path.
- Validation:
  - a pad number must be a pin number in `part.yaml`;
  - every pin except `no_connect` needs at least one pad;
  - `through` pads need a drill, and `top` pads must not have one;
  - several pads may share a number.
- Without a `courtyard`, the courtyard is the pads' bounds plus 0.25 mm.
- `verification.md` gains the line
  `- [ ] Every pad in footprint.yaml matches the recommended land pattern (position, size, drill)`.
- The skill's rule "Never invent pad coordinates" becomes:
  - use a footprint string when a family fits;
  - otherwise transcribe every pad from the datasheet's recommended land pattern into
    `footprint_file`, name the page, and never estimate;
  - the part stays unverified until a human checks it.

- [ ] **Step 1: Write the failing tests:**
  - a pad numbered `9` on a 5-pin part gives an error naming pad 9;
  - a `through` pad without a drill is refused;
  - `footprintFromFile` turns `drill: 0.6` into `{ width: 0.6, height: 0.6 }`;
  - `isVerified(LDO with its verified hash)` stays `true` (from the existing fixture; no
    footprint file);
  - for a verified part with a footprint file, editing one pad's `x` makes `isVerified` false;
  - `generateComponent` for that part writes `footprint={"parts/USBX/footprint.yaml"}`;
  - `generateFootprint("parts/../secret/footprint.yaml", read)` gives an error;
  - MCP `create_part` with `footprint_file` writes `parts/<id>/footprint.yaml` and returns it
    among `files`.
- [ ] **Step 2: Run them and see them fail.** Run
  `npx vitest run test/engine/footprint-file.test.ts test/library.test.ts test/library-safety.test.ts test/mcp.test.ts`.
  Expected: the new tests FAIL and the old ones pass.
- [ ] **Step 3: Implement** to the interfaces and decisions. Update the skill text.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS; typecheck clean.
- [ ] **Step 5: Commit.** Commit message: `Library parts can carry a footprint file that verification covers`.

---

### Task 6: Schematic symbols

**Files:**
- Create: `src/engine/symbols/types.ts`, `passives.ts`, `semis.ts`, `power.ts` (ground and power), `box.ts`, `index.ts`
- Modify: `src/core/library.ts` (`PinSchema` gains optional `side`; the generator writes `pinSides={{"pin1":"left"}}` when any pin has a side)
- Modify: `src/engine/elaborate.ts` (reads `pinSides` into `Component.pinSides`)
- Test: `test/engine/symbols.test.ts`

**Interfaces:**
- Consumes: `Component`, `Side`, `KINDS` (Task 2).
- Produces:
  ```ts
  export type Anchor = "left" | "center" | "right"
  export type Shape =
    | { type: "polyline"; points: Point[]; closed?: boolean; fill?: boolean }
    | { type: "circle"; center: Point; radius: number; fill?: boolean }
    | { type: "arc"; center: Point; radius: number; start: number; end: number } // degrees
    | { type: "text"; text: string; at: Point; anchor: Anchor; size: number; role: "reference" | "value" | "pin-name" | "pin-number" }
  export interface SymbolPin { number: number; name: string; end: Point; side: Side } // end: where a wire attaches
  export interface SchSymbol { kind: string; shapes: Shape[]; pins: SymbolPin[]; bounds: { minX: number; minY: number; maxX: number; maxY: number } }
  export function symbolFor(component: Component): SchSymbol // local coordinates, rotation 0
  export function groundSymbol(): Shape[]
  export function powerSymbol(name: string): Shape[]
  ```

Decisions:
- The schematic grid is 0.1 unit, and every pin end lies on it.
- Two-pin symbols are horizontal, with pin ends at (−0.5, 0) and (0.5, 0). This covers resistor,
  capacitor (a curved plate when polarized), inductor, fuse, crystal, switch, diode, LED and
  battery.
- Three-pin symbols:
  - transistor: base (−0.5, 0), collector (0.3, 0.5), emitter (0.3, −0.5);
  - mosfet: gate (−0.5, 0), drain (0.3, 0.5), source (0.3, −0.5);
  - potentiometer: pin1 (−0.5, 0), pin3 (0.5, 0), wiper (0, 0.4).
- testpoint: pin end at (0, −0.3). pushbutton: pins 1 and 2 at x = −0.5, pins 3 and 4 at x = 0.5.
- `pinheader`, `connector`, `chip` and any kind with no drawing of its own get a box.
  - Pins are 0.2 apart and 0.2 long.
  - The box width is the longest left pin name plus the longest right pin name plus 0.4, at least
    1.0, rounded up to 0.2. Text widths are taken as 0.6 × size per character.
  - Pin sides come from `pinSides` first. Otherwise `power_in` goes to the top, `ground` to the
    bottom, `output` and `power_out` to the right, and everything else to the left. Within a
    side, pins are ordered by number.
- Text sizes: reference and value 0.16, pin names 0.12, pin numbers 0.1.
- Variants: `diode` with `variant` set to `zener`, `tvs` or `schottky` draws that bar.
  `transistor` with `type` `pnp` turns the emitter arrow inward. `mosfet` with `channelType` `p`
  turns the arrow outward. `capacitor` with `polarized` draws a curved plate and a `+`.
- No drawing is copied from `schematic-symbols` (its package states no licence).

- [ ] **Step 1: Write the failing tests:**
  - `every built-in kind has a symbol with its pins`: for each key of `KINDS`, the numbers in
    `symbolFor(component).pins` equal the component's pin numbers.
  - `pin ends lie on the 0.1 grid`, for every kind and for a 14-pin chip.
  - `chip pins go to their sides`: the AP2112K-like chip has VIN on top, GND on the bottom, VOUT
    on the right and EN on the left. With `pinSides={{ pin1: "left" }}`, VIN goes to the left.
  - `the box grows with its pins`: 8 left pins make the bounds at least 1.6 tall.
  - `library pins can name a side`: `part.yaml` with `side: right` on pin 3 generates
    `pinSides={{"pin3":"right"}}`.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run test/engine/symbols.test.ts test/library.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the files to the decisions.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS; typecheck clean.
- [ ] **Step 5: Commit.** Commit message: `Engine draws its own schematic symbols and chip boxes`.

---

### Task 7: Schematic layout

**Files:**
- Create: `src/engine/schematic.ts`, `src/engine/schematic-nets.ts` (wires for named nets, labels, junctions)
- Test: `test/engine/schematic.test.ts`

**Interfaces:**
- Consumes: `Circuit` (Task 2), `SchSymbol`, `symbolFor`, `groundSymbol`, `powerSymbol` (Task 6).
- Produces:
  ```ts
  export interface PlacedSymbol { component: string; x: number; y: number; rotation: number; autoPlaced: boolean; symbol: SchSymbol; pinEnds: Record<string, Point> } // pinEnds keyed by pin id, in sheet coordinates
  export interface Wire { id: string; net: string; points: Point[]; connection?: string } // connection: Connection.id when it came from a trace
  export interface NetLabel { id: string; net: string; text: string; at: Point; side: Side; style: "label" | "ground" | "power" }
  export interface SchematicLayout { symbols: PlacedSymbol[]; wires: Wire[]; labels: NetLabel[]; junctions: Point[] }
  export function layoutSchematic(circuit: Circuit): SchematicLayout
  ```

Decisions:
- A symbol with `sch` stays exactly there, with the rotation Task 2 already rounded to 0, 90,
  180 or 270.
- Symbols without `sch` are auto-placed and stacked downward in id order:
  - in a column 1.0 to the right of the placed symbols' bounds (at x = 0 when none are placed);
  - 0.4 apart, snapped to 0.1;
  - marked `autoPlaced: true`.
- A connection with `corners` gives a wire through `[from end, ...corners, to end]`. When one end
  is a named net, the wire stops at the last corner and a label of that net sits there.
- A pin-to-pin connection without corners gives a right-angle wire. It runs horizontally from
  the `from` pin to the `to` pin's x, then vertically. Aligned pins get one straight segment.
- Pins tied to a named net only through `net.X`:
  - build a minimum spanning tree over those pins by Manhattan distance, breaking ties by pin id;
  - draw every tree edge no longer than `board.schMaxTraceDistance` (default 3.0) as a
    right-angle wire.
- Labels:
  - Clusters are the pins joined by any wire.
  - Ground nets (`/^[ADPF]?GND\w*$|^VSS\w*$/i`) and power nets (`/^(VCC|VDD|VBUS|VIN|V\d|\+)/i`)
    get their symbol on every cluster.
  - Any other named net gets a label on every cluster, but only when it has two or more clusters.
  - A label sits at the cluster's first pin (by id) and faces away from the symbol.
- A junction marks a point where three or more wire ends or pin ends meet, or where a wire ends
  on the inside of another wire.

- [ ] **Step 1: Write the failing tests:**
  - `placed symbols stay put`: R1 at `schX={3.5} schY={-2.5} schRotation={-90}` gives
    `{ x: 3.5, y: -2.5, rotation: 270, autoPlaced: false }`, and the pin ends rotate with it:
    pin1's end moves from (−0.5, 0) to (0, 0.5) relative to the symbol.
  - `unplaced symbols are auto-placed without overlap`: three unplaced resistors have
    non-intersecting bounds, all marked auto-placed.
  - `hand-drawn corners are kept exactly`: corners `[{x:1,y:0},{x:1,y:2}]` from R1.pin2 to
    R2.pin1 give one wire whose points equal `[R1 pin2 end, {x:1,y:0}, {x:1,y:2}, R2 pin1 end]`.
  - `pin-to-pin wires turn once`: from (0, 0) to (2, 1), the points are
    `[{x:0,y:0}, {x:2,y:0}, {x:2,y:1}]`.
  - `far pins on a named net get labels, near ones a wire`: with `schMaxTraceDistance` 3, two
    `CC1` pins 1.0 apart give one wire and no label; two `CC1` pins 10 apart give no wire and two
    labels with text `CC1`.
  - `ground nets get a ground symbol per cluster`: three GND pins far apart give three labels
    with `style: "ground"`.
  - `three wires meeting make a junction`.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run test/engine/schematic.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** to the decisions.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS; typecheck clean.
- [ ] **Step 5: Commit.** Commit message: `Engine lays out the schematic and keeps hand-drawn wires`.

---

### Task 8: PCB placement and ratsnest

**Files:**
- Create: `src/engine/pcb.ts`, `src/engine/ratsnest.ts`
- Test: `test/engine/pcb.test.ts`, `test/engine/ratsnest.test.ts`

**Interfaces:**
- Consumes: `Circuit` (Task 2), `Footprint`, `Pad` (Task 3).
- Produces:
  ```ts
  export interface WorldPad extends Pad { id: string; component: string; pin?: string; net?: string } // id "<component>#<pad number>[#n]"; coordinates on the board
  export interface PlacedFootprint { component: string; x: number; y: number; rotation: number; side: "top" | "bottom"; autoPlaced: boolean; footprint?: Footprint; pads: WorldPad[]; courtyard: Point[]; silkscreen: Point[][]; fabrication: Point[][] }
  export interface RatsnestLine { net: string; from: string; to: string; a: Point; b: Point } // pad ids and centres
  export interface PcbLayout { board?: Board; parts: PlacedFootprint[]; ratsnest: RatsnestLine[] }
  export function layoutPcb(circuit: Circuit, footprintOf: (component: Component) => Footprint | { error: string }): { layout: PcbLayout; diagnostics: Diagnostic[] }
  export function ratsnest(parts: PlacedFootprint[]): RatsnestLine[]
  ```

Decisions:
- Transform a footprint by rotating it counter-clockwise by `rotation`, then mirroring x for
  `side: "bottom"`, then moving it. On the bottom side, `top` pads become `bottom` pads;
  `through` pads stay as they are.
- A component without `footprint` is placed with no pads and a 1 × 1 mm courtyard. One warning
  `no-footprint` lists every such part.
- Auto-placement: parts without `pcb`, in id order. Scan a 0.5 mm grid in rings of growing
  distance from the board centre (the origin when there is no board). Take the first spot where
  the part's courtyard overlaps no other courtyard and lies inside the board outline's bounds.
  When the board has no free spot, keep scanning outside it, out to 200 mm. Add one warning
  `auto-placed` listing the parts.
- A footprint error gives an error diagnostic with code `footprint` naming the part. The part is
  still placed, with no pads and a 1 × 1 mm courtyard.
- A pad's `pin` is `<component>.pin<number>` when that pin exists; its `net` is the pin's net.
- Ratsnest: for each net, Prim's minimum spanning tree over its pads by centre-to-centre
  distance, breaking ties by pad id. Pads of one pin (multi-pad pins) take part like any other.

- [ ] **Step 1: Write the failing tests:**
  - `placed parts stay put and rotate`: a 0402 at `pcbX={2} pcbY={1} pcbRotation={90}` has
    pad 1 at (2, 1 − d), where d is the pad centre distance of the unrotated pad 1 from the
    origin (the pad moves from (−d, 0) to (0, −d)).
  - `bottom parts are mirrored`: pad 1 of a bottom 0402 at the origin has x > 0, and its layers
    are `"bottom"`.
  - `auto-placed parts do not overlap and stay on the board`: five unplaced 0603s on a 20 × 20
    board have courtyards that do not intersect each other, all inside the board, all
    `autoPlaced`.
  - `no board, still placed`: unplaced parts with no `<board>` are placed around the origin.
  - `an unknown footprint keeps the part`: `footprint="bga64"` gives a part with
    `pads.length === 0` and a `footprint` error naming it.
  - `pads know their nets`: R1 pad 2 has `net === "net.GND"`.
  - `ratsnest is a minimum spanning tree`: three GND pads at x = 0, 1 and 5 give two lines,
    (0→1) and (1→5).
- [ ] **Step 2: Run them and see them fail.** Run
  `npx vitest run test/engine/pcb.test.ts test/engine/ratsnest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the decisions.
- [ ] **Step 4: Run the tests and see them pass.** Expected: PASS; typecheck clean.
- [ ] **Step 5: Commit.** Commit message: `Engine places footprints and draws the ratsnest`.

---

### Task 9: Build the design in a worker

**Files:**
- Create: `src/engine/design.ts`, `src/engine/project-files.ts`, `src/engine/engine.ts`, `src/engine/engine-worker.ts`, `src/engine/index.ts`
- Modify: `vitest.config.ts` (exclude `src/engine/engine-worker.ts` from coverage, as `src/cli.ts` is)
- Test: `test/engine/design.test.ts`, `test/engine/engine.test.ts`, `test/engine/project-files.test.ts`, `test/engine/performance.test.ts`

**Interfaces:**
- Consumes: `evaluateCircuit` (Task 1), `elaborate` (Task 2), `generateFootprint` and `padCount`
  (Tasks 3–5), `symbolFor` (Task 6), `layoutSchematic` (Task 7), `layoutPcb` (Task 8).
- Produces:
  ```ts
  // design.ts
  export interface Design { version: 1; file: string; circuit: Circuit; schematic: SchematicLayout; pcb: PcbLayout; diagnostics: Diagnostic[] }
  export function buildDesign(files: Readonly<Record<string, string>>, main: string): Design // throws CircuitCodeError
  // project-files.ts: collectProjectFiles moves here unchanged from src/studio/evaluator.ts
  export async function collectProjectFiles(root: string, limits?: { maxBytes?: number; maxFiles?: number }): Promise<Record<string, string>>
  // engine.ts
  export interface EngineWorker { postMessage(m: unknown): void; on(e: "message", l: (m: unknown) => void): unknown; on(e: "error", l: (err: Error) => void): unknown; on(e: "exit", l: (code: number) => void): unknown; terminate(): unknown }
  export class Engine {
    constructor(options?: { timeoutMs?: number; createWorker?: () => EngineWorker }) // timeout default 30_000
    build(root: string, file: string): Promise<Design> // one build at a time, in request order
    stop(): Promise<void>
  }
  // index.ts re-exports Design, buildDesign, Engine, CircuitCodeError and the model types
  ```

Decisions:
- `Design` holds only JSON values, so it crosses the worker boundary and HTTP unchanged.
- Messages:
  - to the worker: `{ id, files, main }`;
  - from the worker: `{ id, design }` or `{ id, error: { message, code: "circuit-code" | "internal" } }`.
- On a timeout, the client terminates the worker and rejects with
  `CircuitCodeError("The circuit code took longer than 30 s and was stopped")`; the next build
  starts a new worker. When the worker exits, every waiting build is rejected and the next build
  starts a new worker.
- `collectProjectFiles` moves to `src/engine/project-files.ts`. `src/studio/evaluator.ts`
  imports it from there until Task 12 deletes the evaluator. Its tests move to
  `test/engine/project-files.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `design.test.ts`:
    - building `test/fixtures.ts`'s `BOARD` with a `shared.ts`
      (`export const regulatorProps = { footprint: "sot23_5", pinCount: 5 }; export const offset = 1`)
      gives components `R1, C1, LED1, RX, RX~2, U1, R9`, a non-empty `pcb.ratsnest`, one
      `duplicate-name` error, and one `no-footprint` warning whose items are
      `["LED1", "R9", "RX", "RX~2"]`;
    - `structuredClone(design)` deep-equals `design`;
    - a syntax error throws `CircuitCodeError`.
  - `engine.test.ts` uses a fake worker that calls `buildDesign` in-process:
    - two builds resolve in request order;
    - with `timeoutMs: 50` and a fake that never answers, the build rejects with
      `/took longer than/` and `terminate` was called;
    - the next build after an `exit` uses a new worker (the factory is called twice).
  - `performance.test.ts` generates a 200-part board: 100 resistors `0402`, 50 capacitors
    `0603` and 50 LEDs `0603` in rows, with a trace from every part to `net.GND` and one between
    neighbours. After one warm-up build, the median of five `buildDesign` runs stays under
    300 ms. The goal is 100 ms; the test fails only when the goal is missed by a wide margin.
    Print the median.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run test/engine`. Expected: the new
  tests FAIL.
- [ ] **Step 3: Implement.**
  - `buildDesign`: evaluate → elaborate (`padCount` from the footprint module) → one
    `generateFootprint` per distinct footprint string, with `readFile` from `files` →
    `layoutSchematic` → `layoutPcb` → concatenate diagnostics in step order.
  - `engine-worker.ts` calls `buildDesign`.
  - `Engine` follows `src/studio/evaluator.ts` (queue, waiters, reset) without the tscircuit
    parts. The worker URL is `new URL("./engine-worker.js", import.meta.url)`.
- [ ] **Step 4: Run the tests and see them pass.** Run `npx vitest run test/engine`, then
  `npm test`. Expected: PASS for both. Typecheck clean. The Studio still runs on the old evaluator
  until Task 12.
- [ ] **Step 5: Commit.** Commit message: `Engine builds a design in a worker thread`.

---

### Task 10: PCB renderer reads the design

The new renderer goes into new files, so the Studio keeps working on the old one until Task 12
switches over and deletes it.

**Files:**
- Create: `studio/src/pcb/ctx.ts`. Move `Ctx`, `PALETTE` and `anchorAlignment` here from
  `render.ts`; `render.ts` and `schematic-render.ts` import them from here.
- Create: `studio/src/pcb/pcb-draw.ts`
- Test: `test/pcb-draw.test.ts`

**Interfaces:**
- Consumes: `PcbLayout`, `PlacedFootprint`, `WorldPad`, `RatsnestLine` (Task 8); `Camera`,
  `Size`, `Point` and `PartBox` from `studio/src/pcb/geometry.ts`.
- Produces (in `pcb-draw.ts`):
  ```ts
  export interface PcbDrawOptions { ratio: number; layers?: Partial<Layers>; highlight?: { net: string }; moving?: { component: string; by: Point }; ratsnest?: boolean } // ratsnest defaults to true
  export function drawPcb(ctx: Ctx, layout: PcbLayout, view: { camera: Camera; size: Size }, options: PcbDrawOptions): void
  export function padAt(layout: PcbLayout, p: Point): WorldPad | undefined
  export function pcbBoxes(layout: PcbLayout): PartBox[] // one box per part from its courtyard; id = component
  ```

Decisions:
- Drawing order, unchanged from today: board, bottom copper, top copper, drills, silkscreen,
  courtyard, fabrication.
- Then the ratsnest: 1 px lines in `PALETTE.ratsnest = "#e9e6df"` at 60% alpha. Lines touching
  the moving part follow it.
- Reference designators are drawn as silkscreen text above each part's courtyard.
- Pads:
  - `rect` and `roundrect` drawn with their rotation;
  - `oval` as a stadium;
  - drills as a circle or a slot;
  - bottom pads in `bottomCopper`.
- The `unsupported` return value and the circuit-to-canvas fallback go away.

- [ ] **Step 1: Write the tests against a small design** built with `buildDesign` from a
  two-resistor board. They use the `Ctx` test double from `test/pcb-render.test.ts` and assert:
  - a `roundrect` pad issues `arcTo` calls;
  - a through pad draws its drill;
  - highlighting `net.GND` draws other copper with `globalAlpha` 0.3;
  - `padAt` finds R1 pad 1 at its centre and nothing 5 mm away;
  - with `ratsnest: false`, no line uses the ratsnest colour;
  - `pcbBoxes` gives one box per part.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run test/pcb-draw.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm test` and `npm run typecheck`.
  Expected: PASS and no errors.
- [ ] **Step 5: Commit.** Commit message: `PCB renderer draws copperflow's design`.

---

### Task 11: Schematic renderer and wiring read the design

As in Task 10, the new code goes into new files, and Task 12 deletes the old ones.

**Files:**
- Create: `studio/src/pcb/schematic-draw.ts`, `studio/src/pcb/wire-tool.ts`
- Test: `test/schematic-draw.test.ts`, `test/wire-tool.test.ts`

**Interfaces:**
- Consumes: `SchematicLayout`, `PlacedSymbol`, `Wire`, `NetLabel` (Task 7), `Shape`, `groundSymbol`, `powerSymbol` (Task 6), `Design` (Task 9), `Ctx` (Task 10).
- Produces:
  ```ts
  // schematic-draw.ts
  export interface SchematicDrawOptions { ratio: number; showPins?: boolean; activePins?: readonly string[]; moving?: { component: string; by: Point }; pending?: readonly Point[] } // activePins: pin ids; pending: a wire waiting for its build, drawn dashed
  export function drawSchematic(ctx: Ctx, layout: SchematicLayout, view: { camera: Camera; size: Size }, options: SchematicDrawOptions): void
  export function sheetBoxes(layout: SchematicLayout): PartBox[] // one box per symbol from its bounds; id = component
  // wire-tool.ts
  export interface WireEnd { selector: string; at: Point; label: string; net?: string } // selector "R1.pin1" or "net.X"
  export function pinAt(design: Design, p: Point, maxDistance: number): { pin: string; at: Point } | undefined
  export function endAt(design: Design, p: Point, maxDistance: number): WireEnd | undefined // pin, label or wire under the pointer
  export function wireEdits(design: Design, start: WireEnd, end: WireEnd, corners: Point[]): Edit[] // what the W tool writes; [] when start and end are already on one net
  ```

Decisions:
- Keep today's wiring behaviour:
  - click an empty pin or press W over a pin;
  - right-angle preview;
  - finish on a pin, a label or a wire (a wire stands for its net, `net.<name>`);
  - Esc or right-click cancels;
  - joining two differently named nets asks first;
  - a trace already present is refused.
  Corners go into `schematicRouteHints`.
- Nothing from `drawnWires`, the hidden-trace set or the other tscircuit workarounds in
  `wiring.ts` is carried over. Every wire now comes from the design.
- Labels are drawn as today's net labels. `ground` and `power` labels draw `groundSymbol()` and
  `powerSymbol(text)`.

- [ ] **Step 1: Write the tests against designs from `buildDesign`.** They assert:
  - `drawSchematic` draws a resistor's polyline and both pin numbers;
  - an active pin is drawn in `activePort`;
  - a `ground` label draws the ground shape;
  - `pinAt` finds `R1.pin1` within 0.12 and nothing beyond;
  - `endAt` on a wire of net `GND` gives `{ selector: "net.GND" }`;
  - `wireEdits` from R1.pin2 to R2.pin1 with one corner gives one `addTrace` with
    `schematicRouteHints` of that corner;
  - `wireEdits` between two pins already on one net gives `[]`.
- [ ] **Step 2: Run them and see them fail.** Run
  `npx vitest run test/schematic-draw.test.ts test/wire-tool.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm test` and `npm run typecheck`.
  Expected: PASS and no errors.
- [ ] **Step 5: Commit.** Commit message: `Schematic renderer and wiring read copperflow's design`.

---

### Task 12: The Studio runs on the engine

**Files:**
- Modify: `src/studio/live.ts`, `src/studio/server.ts`, `src/cli-commands.ts` (the `studio` command)
- Modify: `studio/src/api.ts`, `App.tsx`, `Inspector.tsx`, `pcb/PcbCanvas.tsx`, `pcb/SchematicCanvas.tsx`
- Modify: `studio/src/pcb/geometry.ts`. Remove the part-box helpers that read circuit JSON;
  `pcbBoxes` and `sheetBoxes` replace them.
- Delete: `studio/src/circuit-json.ts`, `studio/src/pcb/render.ts`, `nets.ts`,
  `schematic-render.ts`, `wiring.ts`, `src/studio/evaluator.ts`, `src/studio/eval-worker.ts`,
  and their tests `test/pcb-render.test.ts`, `test/schematic-render.test.ts`,
  `test/wiring.test.ts` and `test/evaluator.test.ts`. First move the `Ctx` test double into
  `test/pcb-draw.test.ts`.
- Modify: `package.json`. Remove the devDependencies `circuit-json`, `circuit-to-canvas`,
  `schematic-symbols`, `transformation-matrix`, `@tscircuit/alphabet`,
  `@tscircuit/circuit-json-util` and `format-si-unit`, then run `npm install`.
- Test: `test/studio.test.ts`, `test/pcb-geometry.test.ts`

**Interfaces:**
- Consumes: `Engine`, `Design` (Task 9), `drawPcb`, `padAt`, `pcbBoxes` (Task 10),
  `drawSchematic`, `sheetBoxes`, `pinAt`, `endAt`, `wireEdits` (Task 11).
- Produces:
  ```ts
  // live.ts
  export interface DesignBuilder { build(root: string, file: string): Promise<Design> }
  export interface BuildState { status: "idle" | "building" | "done" | "failed"; design?: Design; error?: string; finishedAt?: string }
  new LiveProject(root: string, builder: DesignBuilder)
  // server.ts
  startStudio(options: { root: string; port?: number; staticDir?: string; maxStreams?: number; builder?: DesignBuilder }) // builder defaults to new Engine()
  ```

Decisions:
- `GET /api/build` returns `BuildState` with `design`. A failed build keeps the previous
  `design` and sets `error`.
- After `POST /api/edit`, `/api/place`, `/api/undo` and every MCP edit made in this process, the
  server requests the build at once. The file-watch debounce for edits from outside drops from
  150 ms to 50 ms.
- The status pill counts `design.diagnostics` errors. The Inspector's check list groups
  diagnostics by `code` and shows each message and its items.
- No "Updating…" badge. While the build that follows a W edit runs, the wire waiting for it is
  drawn dashed (`pending`).
- Auto-placed parts are drawn at 60% alpha with a dashed courtyard. A "Keep these positions"
  button in the PCB and schematic toolbars appears when any part is auto-placed. It sends one
  `POST /api/edit` with `setProps` (`pcbX`/`pcbY` or `schX`/`schY`, rounded to 0.01) for every
  auto-placed part in that view, under the summary "Keep auto-placed positions". To allow this,
  raise the `edits` limit in `Bodies.edit` from 50 to 500.
- The Inspector's "centre on part" uses `design.pcb.parts`.
- `npm run build` must still write `dist/app/THIRD_PARTY_LICENSES.txt`.

- [ ] **Step 1: Write the failing tests** in `test/studio.test.ts`, replacing the fake-tsci
  setup with the real engine and the fixture plus `shared.ts`:
  - `GET /api/build` after `POST /api/build` eventually returns `status: "done"`, with
    `design.circuit.components` containing `R1`;
  - writing a syntax error into the circuit file gives `status: "failed"`, an `error` matching
    `main.circuit.tsx:`, and `design.circuit.components` still containing `R1`;
  - `POST /api/edit` moving R1 gives a new `finishedAt` within 2 s without waiting for the
    watcher;
  - `POST /api/edit` accepts 120 `setProps` edits in one request.
- [ ] **Step 2: Run them and see them fail.** Run `npx vitest run test/studio.test.ts`. Expected:
  FAIL.
- [ ] **Step 3: Implement** the server and live changes, then the React side.
- [ ] **Step 4: Verify.**
  - Run `npm test` and `npm run typecheck`. Expected: PASS and no errors.
  - Run `npm run build`, then `node dist/cli.js studio examples/usb-c-ldo`. Open the printed
    address in the in-app browser and check:
    - both views draw;
    - dragging R1 on the PCB moves it and its ratsnest lines;
    - drawing a wire with W and one corner writes `schematicRouteHints` and shows the wire at
      once;
    - no text on the page contains "tscircuit".
  - Take a screenshot of each view for the maintainer.
- [ ] **Step 5: Commit.** Commit message: `Studio draws copperflow's own design instead of circuit JSON`.

---

### Task 13: BOM and package read the design

**Files:**
- Modify: `src/core/bom.ts`, `src/cli-commands.ts` (`bom`, `package`; remove `--build`), `src/mcp/server.ts` (`bom`, `export_package`; remove `build`), `src/studio/server.ts` (`/api/bom` and `/api/package` use the live design when it is current, else build)
- Modify: `README.md` and `skills/copperflow/SKILL.md` where they describe `--build` or `build: true`
- Test: `test/bom.test.ts`, `test/cli.test.ts`, `test/mcp.test.ts`

**Interfaces:**
- Consumes: `Design`, `Engine` (Task 9).
- Produces:
  ```ts
  export async function buildBom(root: string, file: string, options?: { design?: Design; engine?: Engine }): Promise<BomLine[]>
  export async function exportPackage(root: string, file: string, options?: { outDir?: string; design?: Design; engine?: Engine }): Promise<{ outDir: string; files: string[] }>
  ```
  Without a design, these build one with the given engine. Without an engine, they start one and
  stop it afterwards.

Decisions:
- Lines come from `design.circuit.components`:
  - kind;
  - value;
  - footprint;
  - MPN: from the component, or from the library part;
  - supplier: the first entry of `supplierPartNumbers`, written `jlcpcb C456012`, or from the
    library part;
  - library part: `component.library`.
- Grouping key: kind, library, value, footprint, MPN, supplier, plus the remaining props as JSON
  with sorted keys, excluding `name`, `key`, `children` and every `pcb*` and `sch*` prop.
- Parts made in `.map()` loops now appear. Parts with a footprint error still appear.

- [ ] **Step 1: Write the failing tests:**
  - two resistors made by `.map()` with the same value give one line with quantity 2;
  - `supplierPartNumbers={{ jlcpcb: ["C25905"] }}` gives `supplier: "jlcpcb C25905"`;
  - the library part LDO shows `verified: false` until verified;
  - a `footprint="bga64"` part still has a line;
  - `copperflow bom main.circuit.tsx --build` exits non-zero, and its message names `--build`;
  - MCP `bom` has no `build` input.
- [ ] **Step 2: Run them and see them fail.** Run
  `npx vitest run test/bom.test.ts test/cli.test.ts test/mcp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** to the interfaces and decisions. Update the docs.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm test`. Expected: PASS; typecheck
  clean.
- [ ] **Step 5: Commit.** Commit message: `BOM and package come from the engine's design`.

---

### Task 14: Migrate the example

**Files:**
- Create: `examples/usb-c-ldo/parts/TYPE-C-6P/part.yaml`, `footprint.yaml`, the generated `TYPE_C_6P.tsx`, `verification.md`
- Modify: `examples/usb-c-ldo/index.circuit.tsx`
- Modify: `README.md`. The Studio section says the PCB shows the ratsnest until routing arrives
  (stages 4 and 5), and footprints and symbols are copperflow's own.
- Modify: `skills/copperflow/references/editable-subset.md` (pin names table, footprint families)
- Test: `test/engine/example.test.ts`

Decisions:
- The connector is LCSC C456012, SHOU HAN TYPE-C 6P: a 6-pin, power-only USB-C receptacle.
  - LCSC lists no datasheet for it. Get the manufacturer's drawing from the manufacturer or
    from JLCPCB's part page. If no drawing can be found, stop and ask the maintainer.
  - Never use pad data from EasyEDA's or anyone else's library.
- Pins, with numbers as the drawing numbers them: `VBUS1`, `VBUS2`, `GND1`, `GND2`, `CC1`, `CC2`
  (all `passive` except `VBUS*`, which are `power_out`, and `GND*`, which are `ground`), plus
  `EH` for the shell tabs (`ground`, several pads).
  - The `jlcpcb` supplier is `C456012`.
  - `verification.md` names the drawing and its page.
  - The part stays unverified; the maintainer verifies it.
- In the example, `<connector standard="usb_c" … />` becomes `<TYPE_C_6P name="J1" … />`. It
  keeps J1's positions and drops the props the library part owns.

- [ ] **Step 1: Write the failing test** in `test/engine/example.test.ts`:
  - build `examples/usb-c-ldo` with `collectProjectFiles` and `buildDesign`;
  - expect no diagnostic with severity `error`;
  - expect the 25 traces to resolve into the nets `GND`, `VBUS`, `V3_3`, `CC1`, `CC2` and
    `LED_A`;
  - expect every J1 pad to have a net;
  - expect `design.circuit.components.find((c) => c.id === "J1")?.library` to be `"TYPE-C-6P"`.
- [ ] **Step 2: Run it and see it fail.** Run `npx vitest run test/engine/example.test.ts`.
  Expected: FAIL (`unsupported-element` for the USB-C connector).
- [ ] **Step 3: Create the part** with `copperflow` itself, using `create_part` through the CLI
  or a small script that calls `createPart` with `footprintFile`. Then edit the example.
- [ ] **Step 4: Verify.**
  - Run `npm test`, `npm run typecheck` and `npm run build`. Expected: all pass.
  - Run `node dist/cli.js bom examples/usb-c-ldo/index.circuit.tsx`. Expected: J1 shows
    `jlcpcb C456012` and "not verified".
  - Open the Studio on the example and take screenshots of both views for the maintainer.
- [ ] **Step 5: Commit.** Commit message: `Example uses a library USB-C connector with its own footprint file`.

---

## After stage 1

The next plans, one per stage, are written when this one is done:

- Stage 2: rules and checks; `copperflow check` leaves tscircuit.
- Stage 3: blocks, instances and hierarchical sheets; the I/O module benchmark; through-hole
  axial and radial parts, HC-49 and terminal blocks.
- Stage 4: hand routing and the layout file.
- Stage 5: the router and the benchmark harness.
- Stage 6: fabrication outputs; tscircuit removed everywhere.
