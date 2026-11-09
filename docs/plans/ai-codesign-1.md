# AI co-design round 1: the program does the routine work

Direction from the maintainer (2026-11-09): copperflow is a PCB tool that people and AI models design with together. People get EasyEDA Pro's hand-editing experience (the Studio UX rounds). Models must be able to design without filling their context: they say what the circuit is, and the program places, wires and checks it. Today a model that wants a clean schematic has to write `schematicRouteHints` for every wire and `schX`/`schY` for every part, and `circuit_summary` returns every prop of every part. This round removes that work.

Facts (see `src/engine/schematic.ts`, `schematic-nets.ts`, `src/mcp/server.ts`):

- A trace without corners is drawn as one right-angle elbow between its pins, straight through whatever is in the way. Pins of a named net within 3 units get the same elbow; farther ones get a label or a power/ground flag.
- Parts without `schX`/`schY` are stacked in one column to the right of the placed ones.
- The agent's tools are one edit per call; `circuit_summary` and `check_circuit` print everything.
- Hand-drawn things are never re-laid out (engine design, goal 2). Auto-placed parts are marked `autoPlaced`; auto-drawn wires have no `connection`.

## Global constraints

The Studio UX rounds' constraints hold (English; one-line commits without trailers; no new dependencies; small tested modules; typecheck, test and build pass). Everything the engine adds must be deterministic for the same input and must never move a part, wire or label that someone placed (`schX`/`schY`, `schematicRouteHints`). `src/core/` changes only where a task says so. The MCP tools keep their safety rules: locks, one history entry per call, no unlock or verify tools.

## Task 1: schematic wires that avoid things

- New pure module `src/engine/schematic-route.ts`: an orthogonal router on the 0.1 sheet grid. Obstacles: symbol bodies (their bounds plus a 0.1 margin, pins' own ends excepted), hand-drawn wires, and wires already routed in this run. It routes each connection that has no corners and each near-pin edge of a named net (`layoutNets` edges) as a shortest path with few bends (A* or Lee on the grid, with a bend cost), deterministic in the order the connections and nets come. When no path exists inside a bounded search box, it falls back to today's elbow and the design carries a `warning` diagnostic ("wire from A to B could not avoid …").
- Junctions appear where a routed wire joins a wire of the same net; a routed wire may end on an existing wire of its net instead of running to the far pin (shortest connection to the net's drawn wires, as EasyEDA's auto wire does).
- Performance: 200 parts and 400 connections under 50 ms on the maintainer's machine, measured in a perf test (`npm run test:perf`).
- The Studio needs no change: routed wires are engine wires (no `connection`), so dragging one already turns it into a trace with corners (Studio round 6). Properties' Kind row says "Routed by Studio".
- Tests: a wire routes around a symbol in its way; two nets never share a grid edge; a hand-drawn wire is an obstacle and is never moved; the fallback warning; determinism (same input, same output, twice); the perf bound.

## Task 2: placement by connectivity

- New pure module `src/engine/schematic-place.ts` replaces the column stack for parts without a position: parts are placed left to right by signal flow (connectors and inputs left, outputs and connectors on the right, decided by pin types where known), with the passives that hang off a chip pin placed beside that pin (series parts inline, shunt parts to ground below, to power above), snapped to the grid, never overlapping, each symbol with a 0.2 clearance. Placed parts (`schX`/`schY`) are fixed obstacles. Deterministic.
- `autoPlaced` stays true for these parts, so the Studio still shows them as placeable; "Keep these positions" writes them as today.
- Tests: a regulator with input and output capacitors lands as input → regulator → output with capacitors below; no two symbols overlap on the demo circuit; placed parts do not move; determinism.

## Task 3: tools that answer in a screenful

- `circuit_summary` returns, by default, a compact view: one line per part (`R1 resistor 5.1k 0402 @sch(3.5,-2.5) pcb(-4.5,-4.5)`), one line per net (`GND: J1.GND1 J1.GND2 R1.pin2 …`), then locks, marks and violation counts; a `detail: "full"` parameter gives today's output. Nothing in a default answer exceeds about 60 lines; longer lists end with "… and N more (detail: full)".
- `check_circuit` returns counts by severity, then the first 20 violations, then "… and N more"; a `filter` parameter (`errors`, `warnings`, a part name or a net) narrows it.
- New `edit_circuit`: a list of edits (`set_props`, `connect`, `disconnect`, `place_part`, `remove_part` shapes) applied as one change with one history entry; it stops at the first refused edit and reports what was applied. New `connect_nets`: `{ GND: ["R1.pin2", "C1.pin2"], V3_3: ["U1.VOUT", …] }` in one call, writing one trace per pin.
- The server's instructions tell the model: write parts and connections, not positions or wire corners; the program places and routes; call `check_circuit` once at the end.
- Tests: the compact formats on the demo circuit (line counts), the truncation, `edit_circuit` stopping at a refusal with the applied part reported, `connect_nets` edits.

## Task 4: a circuit from a netlist

- New tool `new_circuit { file, parts: [{ name, kind | library id, value?, footprint? }], nets: { NAME: [pins…] }, board?: { width, height } }`: writes a fresh `*.circuit.tsx` with the imports, the parts (no positions) and the traces, through `src/core` so it is one history entry and respects an existing file (refused unless `replace`). The engine then places and routes it (Tasks 1–2), so the model's whole job is this one call plus `check_circuit`.
- Validation: names, kinds and library ids as `place_part` checks them; pin names checked against the parts' pins; unknown pins reported with the part's real pin names, nothing written.
- Tests: the demo circuit rebuilt from its netlist builds with no errors; a bad pin name is refused with the pin list; `replace` rules.

## Task 5: the Studio shows what the program did

- The schematic shows auto-placed parts and routed wires in the same colours as everything else (no visual difference, as EasyEDA), but Properties says "Placed by Studio" / "Routed by Studio", and the left panel's Component tree marks auto-placed parts with a small dot until they are moved or kept.
- Layout → "Tidy sheet": re-runs placement for the auto-placed parts only (placed parts stay), as one history entry writing their positions; a model can call the same through `set_props` today, so no new tool.
- Tests: the Properties rows; the tidy command's edits touch only auto-placed parts.

## Task 6: proof (controller)

A fresh circuit written through `new_circuit` (the demo's netlist) builds with no errors; its schematic has no wire through a symbol and no overlapping symbols; the model's whole conversation is two tool calls; `circuit_summary` fits a screen. Checked in Chrome on the check copy. Fix what fails before the round ends.
