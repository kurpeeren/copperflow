# copperflow engine design

Status: proposal, waiting for the maintainer's approval (2026-11-05).
Scope: replace tscircuit with copperflow's own engine — compiler, footprints, symbols,
schematic and PCB layout, copper routing, rule checks and fabrication outputs — and the Studio
features that come with it. Rule content, the AI design workflow and example circuits come
later and are not part of this design (see "Later").

## Intent

Today every change in copperflow goes through tscircuit, and the user waits for it. tscircuit
also overrules the user: it lays out hand-drawn schematic wires again, adds its own net labels,
and routes copper we cannot keep or lock. The maintainer wants the engine of the program to be
copperflow's own, written from scratch, studying tscircuit (MIT) and other open tools and doing
better than them where it can be measured.

### What the waiting costs today (measured 2026-11-05 on the maintainer's machine)

All numbers come from tscircuit's eval library kept warm in one process (the fastest path the
Studio has); the tscircuit CLI adds about 20 s of start-up on top.

| Board | Build without routing | Of which schematic | Build with routing | Routing result |
|---|---|---|---|---|
| examples/usb-c-ldo (9 parts) | 1.7 s | – | 2.1 s | complete |
| synthetic 4 in + 4 out channels (43 parts) | 5.0 s | – | refused by default; 10.3 s with `routeRemaining` | 53 vias, 3 rule errors |
| synthetic 8 in + 8 out channels (83 parts) | 10.5 s | about 5.6 s | refused by default; 48.5 s with `routeRemaining` | 128 vias, 12 rule errors |

- By default tscircuit refuses to route a board with more than 50 connections and reports every
  connection as unrouted.
- Its routes on the channel boards break clearance rules (gaps of 0.02–0.03 mm between output
  traces) and place a via on an SMD pad.
- Most of the waiting is not routing: schematic layout and the rest of the compile take 10 s on
  83 parts before any copper is routed. A first build in a fresh process adds about 4 s.

The synthetic boards were placed crudely by script, so their routing numbers are a baseline,
not a verdict on tscircuit's router.

## Goals

1. **No waiting for edits.** A change to a circuit file reaches the screen in under 100 ms for a
   200-part board (compile, schematic, placement, ratsnest, checks). Routing is not part of an
   edit: it runs only when a person or the agent asks for it, in the background, and never blocks
   editing. In the design workflow it is the last step.
2. **What is drawn stays drawn.** Positions, schematic wires and copper tracks that a person or
   the agent placed are never moved or re-laid out by the engine. The engine only fills in what
   nobody placed yet, and it says so.
3. **Blocks and instances.** A block (an input channel, say) is designed once and placed many
   times. Its parts, wiring, placement and routing are shared by every instance unless an
   instance overrides them.
4. **Rules the engine enforces.** Net classes (width, clearance, via), class-to-class clearances
   (isolation between a 24 V field side and the logic side), keepouts, fabrication limits.
   Checks run live while editing, not only at the end.
5. **Its own router.** Routes 2- and 4-layer boards with net classes, keepouts and vias,
   incrementally, without touching locked or hand-drawn copper, and beats tscircuit on the
   benchmark (see "Benchmark").
6. **Fabrication outputs.** Gerber X2, Excellon drill, pick-and-place and BOM files a board
   house accepts.
7. **The Studio grows into a PCB editor.** Ratsnest, hand routing, vias, board outline, keepouts,
   rule violations, block navigation and replicating a block's layout.
8. **No tscircuit at run time.** When the work is done, copperflow runs with no tscircuit
   package installed, globally or locally.

## Non-goals

- Supporting every tscircuit element. The engine supports the elements copperflow uses (the
  built-in kinds in "Parts", plus board, group, trace, net, port, via, hole, keepout and
  copperpour) and grows on demand.
- Keeping files readable by tscircuit. Tag and prop names stay as they are today, but copperflow
  no longer promises that tscircuit opens its files the same way.
- Looking up parts on the network (tscircuit's "parts engine"). Parts come from the project's
  library or from built-in families, and the BOM shows supplier part numbers only where the file
  or the library gives them (today tscircuit fills them in for built-in passives).
- High-speed design features (length matching, impedance control, differential pairs) in this
  design. The model must not rule them out.
- 3D view and simulation.

## Anti-goals (failure even if it "works")

- The engine moves a part, wire or track that someone placed.
- A rule check passes on a board that breaks the project's rules (a check that silently skips
  what it does not understand). Unknown or unchecked cases are reported, not skipped.
- Routed copper exists only in memory and comes out different on the next run.
- An edit in one instance of a block silently changes a different block.
- Code from tscircuit or any other project is copied without its licence terms being met;
  any GPL code ends up in copperflow.

## Constraints

- Licence: Apache 2.0. Code may be ported, with attribution in NOTICE, only from a package that
  ships a permissive LICENSE file (most tscircuit packages ship MIT). Packages with no licence
  file (for example `@tscircuit/infgrid-ijump-astar`, `copper-pour-solver`,
  `schematic-match-adapt`), code bundled inside another package without its own licence, and
  `@tscircuit/krt-wasm` (derived from KiCad routing tools, upstream licence unverified) are
  studied for ideas only. KiCad, Freerouting, gerbv and Falstad are GPL: only their behaviour and
  published ideas may be used, never their code.
- General-purpose tools stay allowed when permissively licensed: the TypeScript/JSX parser and
  transpiler, React for the Studio UI, zod, YAML, and general geometry and file libraries such as
  polygon clipping, a spatial index (R-tree) and a zip writer. Everything circuit-specific is
  copperflow's own: model, footprints, symbols, layout, router, checks, Gerber and drill writers.
- Node.js 22+, Windows, macOS, Linux; local only; no network at run time.
- Everything in the repository is in English.
- Existing behaviour stays: the editable subset, locks and marks, history and undo, the MCP
  tools and their safety rules, the parts library and its human-only verification.
- The program keeps working after every stage (see "Stages").

## Decisions made by the maintainer

- Write the whole engine from scratch; study tscircuit and others, do not depend on them.
- Order: first the infrastructure and the Studio, done well, with rule checking; design-rule
  content, the working hierarchy and example circuits come afterwards.
- The hardest board the first version must handle: an isolated industrial I/O module with
  8 inputs and 8 outputs (24 V field side; optocoupler or digital-isolator isolation; reverse
  polarity and overvoltage protection on inputs; short-circuit-proof high-side outputs; a status
  LED per channel). No functional-safety certification.
- "Better than tscircuit" is decided by measurement on the same boards.
- The schematic is hierarchical: blocks are boxes on the sheet above them and open into their
  own sheet, drawn once for all instances (section 5).

## Architecture

```
circuit files (.circuit.tsx, blocks, library parts)      rules.yaml      *.circuit.layout.json
        │                                                     │                 │
   1 evaluate (worker)  ──► element tree                       │                 │
   2 elaborate          ──► circuit model (stable ids) ◄──────┘                 │
   3 parts              ──► symbols, footprints, pads                            │
   4 schematic          ──► placed symbols, wires, labels                        │
   5 PCB                ──► placed footprints, ratsnest, copper ◄───────────────┘
   6 checks             ──► ERC + DRC violations (incremental)
   7 router (on request)──► new copper ──► written to *.circuit.layout.json
   8 outputs            ──► Gerber, drill, pick-and-place, BOM
```

Every step after evaluation is incremental: an edit recomputes only what it touches. The model
uses stable ids so the Studio, history and checks can follow an item across edits.

### 1. Evaluate

- Circuit files stay TSX and keep running as code, so constants, `.map()`, helper functions
  and library components keep working (the editable subset decides what the Studio can write
  back, as today).
- copperflow ships its own small JSX runtime: an element is a plain object `{ type, props,
  children, source }`. No React in the engine. Function components (blocks, library parts) are
  called by the elaborator, not by the runtime, so it knows which instance an element belongs to.
- Each intrinsic element carries its source location (file, offsets), so the Studio maps any
  item back to the code that made it, including items inside block instances.
- Imports may name only project files and copperflow's own module. Anything else is an error
  with a clear message. No network, no `node_modules` lookups for circuit code.
- Evaluation runs in a worker with a time limit, as the current eval worker does.

### 2. Elaborate: the circuit model

- copperflow's own typed model replaces circuit JSON everywhere (Studio, BOM, checks, exports).
  Circuit JSON is not produced.
- Ids are stable and readable: `R1`, `R1.pin1`, `net.GND`, and for block instances a path such as
  `IN3/R1.pin2`. Re-running the same files gives the same ids.
- The model holds: components (kind, value, MPN, footprint, symbol, pins, positions, rotation,
  side, lock state, block path, source location), pins (number, names, electrical type, pads),
  nets (name, class, pins, scope), the board (outline, layer stack of 2 or 4 copper layers,
  thickness, keepouts, zones), schematic wires (ends and corners), copper (tracks, vias, zones)
  and rule settings.
- Nets are merged with union-find over traces, net labels and block ports.
- Selectors keep today's forms (`.R1 > .pin1`, `R1.pin1`, `net.GND`) and add instance paths.

### 3. Parts: symbols and footprints

- **Footprints** are generated from today's footprint strings by copperflow's own generator, so
  existing files keep working. Families needed first: chip passives (0201–2512), SOD, SOT-23
  variants, SOIC/SOP/TSSOP, QFN, QFP, pin headers, through-hole axial/radial, crystals (HC-49),
  terminal blocks. `bga` follows when needed. Land patterns follow IPC-7351 (nominal density);
  each family has tests against published dimensions.
- A library part whose footprint fits no family gets a footprint file in its part folder
  (pads transcribed from the datasheet). It is part of what a human verifies before the part is
  marked verified. This replaces today's rule that pad coordinates are never written by hand
  (see "Calls made during design").
- The example's USB-C connector, which tscircuit fetched from the network, becomes a library
  part with such a footprint file.
- **Symbols** are copperflow's own drawings for the built-in kinds (resistor, capacitor, polarised
  capacitor, inductor, diode, LED, Zener/TVS, NPN/PNP, N/P MOSFET, fuse, crystal, switch,
  push button, battery, potentiometer, test point, connector, power and ground symbols). Chips are
  boxes generated from their pins; `part.yaml` may say which side each pin goes on, otherwise
  power goes up, ground down, inputs left, outputs right.
- Built-in kinds keep today's tag names and props (resistor … potentiometer, chip, connector),
  pin names and aliases (`pin1`, `anode`, `cathode`, …), and today's pin attributes from
  `part.yaml` electrical types.

### 4. Blocks and instances

- A block is a function component in its own file that contains a `<group>`. It exposes named
  ports with `<port name="FIELD" />`; inside, a trace connects to `port.FIELD`; outside, an
  instance's port is `IN1.FIELD`. Everything stays literal, so it stays editable.
- Nets inside a block are local to each instance (`IN3/net.SENSE`). Global nets (ground,
  supplies) are listed in `rules.yaml`; a block uses them by name.
- Positions inside a block are relative to the block's origin, so every instance shares the
  block's placement. An instance itself is placed and rotated with literal props on its element
  (`<InputChannel name="IN3" pcbX={-40} pcbY={12} pcbRotation={0} />`). Copper whose two ends
  are both inside the block is stored once for the block and drawn in every instance.
- An instance may override one of the block's part positions or tracks. Overrides are layout
  data, not code: they live in the circuit's layout file (section 7), keyed by instance path
  (`IN8/R1`), and the Studio and the summary show them as overrides.
- Moving a part inside an instance asks whether to move it in the block (all instances) or only
  in this instance.
- Locks name either a block part (`R1` in the block file's own annotations: every instance) or an
  instance part (`IN3/R1` in the circuit's annotations: that instance only). An edit to a block
  that would change a locked instance part is refused and names the instance, the same way edits
  to locked parts are refused today; nothing is silently turned into an override.

### 5. Schematic

- The schematic is hierarchical, like KiCad's hierarchical sheets:
  - A circuit without blocks is one sheet, as today.
  - The top sheet shows the circuit's own parts plus one box per block instance. The box carries
    the instance name and has one pin per block port, wired on the top sheet like any other pin.
  - Opening a box shows the block's own sheet: its parts, its wires, and one port label for each
    `<port>`, placed and moved like a part. Blocks inside blocks are sheets inside sheets.
  - A block's sheet is drawn once and shared by every instance. Opened from an instance, it shows
    that instance's names (`IN3/R1`) and values. Per-instance overrides are PCB layout only; a
    schematic drawing has no per-instance overrides.
  - A box is placed with literal `schX`/`schY` on the instance element. Its size follows from its
    port count. Which side a port's pin sits on can be set on the `<port>`; otherwise pins go on
    the left in the order the ports are declared.
  - Global nets (from `rules.yaml`) appear on any sheet as power and ground symbols or net
    labels, with no wire to a box.
  - ERC works on the whole connected circuit. A violation inside a block names the instance and
    points to the place on the block's sheet.
- Parts with `schX`/`schY` stay exactly there. Parts without a position are placed by a simple,
  deterministic rule on their own sheet, never overlapping, and the Studio marks them as
  auto-placed until someone moves them.
- A trace with `schematicRouteHints` is drawn through its corners, as today, but natively.
  A trace without corners is drawn as a right-angle wire between its pins; a pin on a named net
  far from its partners gets a net label instead. Nothing the user drew is re-routed.
- Schematic units stay the numbers used today, so existing positions keep their meaning.

### 6. PCB placement and ratsnest

- Parts with `pcbX`/`pcbY` stay there (relative to their group). Unplaced parts are packed next
  to the other parts of their block without overlapping courtyards, and are marked auto-placed.
- Auto-placed positions are not written anywhere and may change when parts are added. The
  Studio offers "Keep these positions", which writes them as literals in one undoable edit. Until
  then the router does not route to an auto-placed part and says which parts to place first, and
  DRC reports them as unplaced. The same holds for auto-placed schematic symbols, minus routing.
- The ratsnest (shortest connections still missing) is recomputed live, from pads and from the
  copper already on the board.

### 7. Copper and the layout file

- Tracks, vias and per-instance overrides are stored in a committed sidecar,
  `board.circuit.layout.json` next to `board.circuit.tsx`, one record per line so diffs stay
  readable. A track record has an id, net, layer, width, points, whether it is locked, and whether
  a person, the agent or the router made it; a via record has a position, drill, diameter and
  layers. Block-internal copper is stored once per block, relative to the block's origin, in a
  layout file next to the block's file.
- The board outline, keepouts and copper zones are design intent and stay in the TSX
  (`<board>` outline, `<keepout>`, `<copperpour>`), where the agent and the human edit them.
- When a part moves, tracks attached to it are not deleted: they are reported as broken.
  Router-made tracks on a moved part may be ripped up and routed again; hand-made and locked
  tracks are only reported.
- Route edits go through the same history, undo and lock rules as source edits. A history entry
  can cover both files of a circuit.

### 8. Router

- Runs only when a person or the agent asks. It works in a worker, can be cancelled, reports
  progress, and is deterministic for the same input. Its result is written to the layout file as
  one history entry, so one undo removes one routing run.
- If the circuit changes while it runs, the run is discarded or restarted, never applied to a
  circuit it was not computed for.
- Routes what the ratsnest still misses: one net, a selection, a block or everything. It never
  moves locked or hand-made copper.
- Honours net-class widths and clearances, class-to-class clearances, keepouts, board-edge
  clearance and fabrication limits; uses vias on 2- and 4-layer boards; reports what it could
  not route and why.
- Routing a block routes it once for all its instances.
- The algorithm is the builder's choice. A sound starting point is grid-based A* with obstacles
  grown by clearance, negotiated-congestion rip-up and reroute (the published PathFinder idea),
  fanout for fine-pitch parts, then cleanup (45° corners, fewer vias, shorter paths).

### 9. Rules and checks

- `rules.yaml` per project holds:
  - a fabrication profile (minimum track, space, drill, annular ring, board-edge clearance,
    copper layers);
  - net classes (track width, clearance, via size) and which nets belong to each (names or
    patterns);
  - a class-to-class clearance table (for isolation gaps);
  - global nets.
- copperflow ships a conservative default fabrication profile. Real numbers for the I/O module
  come later with the rule content.
- ERC: unconnected pins that need a connection, power inputs with no source, outputs driving
  each other, no-connect pins that are wired, single-pin nets, duplicate designators.
- DRC: copper clearance by class, track width, vias and drills, annular rings, board-edge
  clearance, keepouts, class-to-class clearance across an isolation gap, overlapping courtyards,
  silkscreen on pads, unrouted connections, broken tracks.
- Checks are incremental and use a spatial index; a full check of a 200-part board finishes
  in under a second.
- Each violation has a stable id, a severity, a position and the items involved. The Studio
  draws them; `copperflow check` and the MCP tool list them.
- Anything a check cannot evaluate (an unknown pad shape, say) is a violation, not a pass.

### 10. Fabrication outputs

- Gerber X2 for each copper layer, solder mask, paste, silkscreen and the board outline;
  Excellon drill files for plated and non-plated holes; pick-and-place CSV; the existing BOM.
- `copperflow export` (CLI) and an MCP tool write them into a folder with a zip.
- The default target is JLCPCB for both bare boards and assembly, since the BOM already carries
  its part numbers: its file naming, its pick-and-place columns, and a per-footprint-family
  rotation correction table (the table's values come with the rule content). Other houses come
  later as profiles.
- Tests parse the outputs back with an independent, permissively licensed Gerber reader and
  compare with the model. Before stage 6 ends, the 8+8 benchmark's files are also loaded into
  the board house's online viewer once by a person.

### 11. Studio

- The Studio reads the engine model directly; the renderers move from circuit JSON to the
  model. Edits show at once, with no "Updating…" badge; a running router shows its progress and
  a Cancel button instead.
- PCB editing, in KiCad's spirit (behaviour only):
  - draw tracks from a pad with clicks for corners and a key to change layer, which drops a via;
  - select, delete and lock tracks;
  - route a net, the selection, a block or all;
  - draw and edit the board outline, keepouts and zones;
  - switch between 2 and 4 copper layers;
  - see the ratsnest and the rule violations (on the board and as a list).
- Blocks: a block tree in the left panel, an instance's parts highlight together, a block opens
  for editing, and shared versus overridden layout is visible.
- Schematic sheets: opening an instance's box shows the block's sheet; a breadcrumb (`Top › IN3`)
  shows where the user is and goes back up. Selecting a part on a sheet selects the same part on
  the PCB, and the other way round.
- The PCB stays one board with every instance on it; there are no PCB sheets.
- The schematic keeps today's interaction; the workarounds for tscircuit's layout (hidden traces,
  label stubs) go away.

### 12. CLI and MCP

- `copperflow check`, `bom`, `package` and the MCP tools use the engine; `tsci` is no longer
  called.
- New MCP tools cover routing (route a net, a block or everything), reading violations, editing
  the board outline and keepouts, and block placement. Their exact shape is the builder's call.
  They follow today's safety rules: locks, history, one undo step per call, no unlock or verify
  tools.

## Stages

Each stage leaves the program working; tscircuit stays available only until the stage that
replaces it is done.

1. **Engine core.** Evaluation, the model, footprints and symbols for the families the examples
   use, schematic and PCB placement, ratsnest. The Studio, `bom` and `package` read the model.
   The example board is migrated (USB-C connector as a library part). From here on the Studio
   shows the ratsnest instead of tscircuit's routed copper (tscircuit's copper sits on
   tscircuit's pads and would not line up with copperflow's); copper comes back in stage 4 (by
   hand) and stage 5 (router). `copperflow check` still uses tscircuit until stage 2.
2. **Rules and checks.** `rules.yaml`, ERC, DRC on placement, violations in the Studio, CLI and
   MCP. `copperflow check` moves to the engine, so no project depends on tscircuit to be
   checked from here on.
3. **Blocks and instances.** Ports, local and global nets, shared and overridden placement,
   locks inside blocks, hierarchical schematic sheets, the block tree in the Studio. The
   benchmark I/O module is built here.
4. **Hand routing.** The layout file, track and via editing in the Studio, DRC on copper,
   history and undo for copper.
5. **Router.** The router and the benchmark harness (below).
6. **Fabrication outputs, and tscircuit out.** Exports; tscircuit removed from code, settings,
   docs, README, skill and NOTICE; design.md updated.

## Benchmark

- Boards, kept in the repository under `bench/` with the scripts that generate them:
  - the USB-C example;
  - the synthetic 4+4 and 8+8 channel boards measured above (their generator moves into
    `bench/`). The builder may improve their placement if it makes complete routing impossible,
    and then measures tscircuit again on the new placement;
  - a benchmark version of the isolated 8-in/8-out module with generic parts (the real product,
    with chosen and verified parts, comes later). The builder designs it to this placeholder
    spec: 24 V field supply; each input with series resistor, TVS, reverse-polarity diode,
    4-pin SMD optocoupler and LED; each output with an SO-8 high-side switch, TVS and LED; a
    microcontroller in QFP-48; an isolated DC/DC module; two 10-way 5.08 mm terminal blocks for
    the channels and a 2-way one for the supply; a 2.5 mm isolation gap between field and logic
    side; a 100 × 80 mm board.
- All benchmark boards are 2-layer (the harder case); 4-layer results are reported alongside.
  "The same rules" means copperflow's default fabrication profile plus one placeholder rule set
  in `bench/` (power class 0.5 mm, signal class 0.25 mm, the isolation gap), applied to both
  engines' results by copperflow's DRC.
- Measured for copperflow and for tscircuit on the same placement: connections completed, vias,
  total track length, routing time, rule violations, and copperflow's edit-to-screen time.
- "Better" means: on every board, at least as many connections completed, zero rule
  violations, fewer or equal vias and length, and less time. On the 8+8 board the target is
  complete routing with zero violations in under 30 s (tscircuit: 48.5 s with 12 violations).
- The harness runs from the CLI and writes a table into the repository, so each change to the
  router shows its effect.

## Testing

- Tests come first for every stage, as today.
- Footprints are checked against published land-pattern dimensions; symbols and renderers with
  snapshot tests; checks with small boards that contain exactly one violation each; the router
  with the benchmark boards (the small ones in CI, the large ones on demand); outputs by reading
  them back.
- Performance budgets (the 100 ms edit and the 1 s full check) have tests that fail when
  exceeded by a wide margin.

## Reference: what tscircuit does today

Studied in the installed tscircuit 0.0.3050 (core 0.0.2248), so the builder knows what each stage
replaces and where to look.

| Stage | tscircuit today | Note for copperflow |
|---|---|---|
| Evaluate and elaborate | `@tscircuit/core` runs about 80 render phases over a React tree | copperflow's model is built in one pass per step, incrementally |
| Footprints | `@tscircuit/footprinter`: strings split on `_` into builder calls; fixed default dimensions per family; no IPC-7351 calculation found | IPC-7351-based generator with tests is an improvement to measure |
| Schematic placement | `@tscircuit/matchpack` (pattern steps: decoupling caps, regulator caps, power rows) over `calculate-packing` | copperflow never moves placed symbols; auto-placement only fills gaps |
| Schematic wires | `schematic-trace-solver` bundled in core: orthogonal spanning tree over pins, detours around boxes, net-label placement; `schematicRouteHints` is never read | hand-drawn corners are the source of truth |
| PCB placement | `calculate-packing` PackSolver2 | same role, courtyard-aware, never moves placed parts |
| Routing | `@tscircuit/capacity-autorouter` pipeline 9: capacity mesh, hypergraph port-point A* with rip-up, high-density intra-node solvers, DRC repair; refuses more than 50 connections by default | the benchmark compares against this router |
| Default clearances | JLCPCB minimums bundled in core (0.1 mm trace and pad gaps, 0.2 mm to holes and board edge, 0.3 mm via pad) | copperflow's default profile cites its own source |
| Checks | `@tscircuit/checks`: placement, routing, netlist, schematic and pin checks | copperflow adds net classes, class-to-class gaps and unchecked-case reporting |
| Outputs | `circuit-json-to-gerber`, `circuit-json-to-pnp-csv` (JLCPCB format), `circuit-json-to-bom-csv`, bundled in the CLI | copperflow writes its own |

## Calls made during design (open to change)

1. Circuit files keep running as code with copperflow's own JSX runtime, instead of being read
   only statically, so constants, `.map()` and library components keep working.
2. copperflow's own model with stable ids replaces circuit JSON; the Studio renderers are ported.
3. Tag and prop names stay as today; tscircuit compatibility is no longer promised.
4. No network part lookup; the example's USB-C connector becomes a library part.
5. A library part may carry a hand-transcribed footprint file when no family fits; a human
   checks it as part of verification. Generated families stay the default.
6. Copper and per-instance overrides live in a committed `*.circuit.layout.json`; outline,
   keepouts and zones stay in TSX.
7. Blocks are components with `<port>`s; nets inside a block are per instance; global nets are
   listed in `rules.yaml`.
8. Instances share their block's placement and routing; overrides are per instance. Locks name a
   block part or an instance part, and a block edit that would move a locked instance part is
   refused.
9. 2 and 4 copper layers; benchmarks are judged on 2 layers.
10. The router runs only on request, as the last step of the workflow; its result is one undo
    step.
11. Auto-placed parts are not saved until someone keeps them, and the router does not route to
    them.
12. Rules and checks come before blocks, so `copperflow check` leaves tscircuit early.
13. JLCPCB is the default fabrication and assembly target.
14. General geometry and file libraries (polygon clipping, R-tree, zip) are allowed; everything
    circuit-specific is written here.
15. tscircuit may stay as a development-only dependency for the benchmark until stage 6, then it
    goes entirely.
16. A block's schematic sheet is shared by all its instances, with no per-instance schematic
    overrides; per-instance overrides exist only in the PCB layout.
17. Port pins on a block's box go on the left in declaration order unless the `<port>` names a
    side.

## Left to the builder

- Algorithms and data structures (router, packer, spatial index, incremental recomputation).
- File schemas for the layout file, footprint files and `rules.yaml`, within the rules above.
- Exact Studio interactions and key bindings beyond those named here.
- MCP tool shapes.
- Which transpiler compiles the TSX (permissive licence, fast enough for the 100 ms goal).
- The default fabrication profile's numbers, with their source noted.

## Later (by the maintainer's order, not in this design)

- Design-rule content: IPC tables, isolation distances, the rules for the I/O module.
- The AI design workflow skill: blocks first, block design, cloning channels, part choice,
  approval before PCB, block-by-block layout, board shape and connectors, fine tuning, routing.
- The project vault hierarchy (`PROJECT.md`, `BLOCK.md`, log).
- Example circuits.
