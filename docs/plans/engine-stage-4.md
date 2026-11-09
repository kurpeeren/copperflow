# Engine stage 4: hand routing

Design: `docs/engine-design.md` §7 (copper and the layout file), §9 (DRC on copper), §11 (Studio PCB editing). Stages 1–3's model, placement, ratsnest and checks exist; the Studio's PCB canvas draws pads, outlines, silkscreen and the ratsnest, and the user asked (2026-11-09) for the PCB design tools EasyEDA has: drawing tracks, vias, the board outline, copper areas. This stage gives the PCB copper that a person draws and the Studio tools to draw it; the router is stage 5.

EasyEDA Pro's PCB tools, as measured (`docs/plans/studio-ux-5.md`): Pad (Alt+P), Via, Board Outline, Copper Area, Fill Region, Slot Region, Prohibited Region, Polyline, Text, Length (Alt+N) · Single Routing, Stretch Track (Shift+W), Routing Corner · Check DRC. Routing in EasyEDA: click a pad, click corners (45° or 90° corner mode), click the destination pad; a key changes layer and drops a via; `Esc` cancels; tracks are selectable and their segments draggable; DRC marks clearance and width violations live.

## Global constraints

The repository's constraints hold (English; one-line commits without trailers; no new dependencies except a permissively licensed geometry library if a task says so; small tested modules; typecheck, test and build pass; `src/engine/` deterministic; nothing a person placed is moved by the engine). Licence rule: no code from KiCad, Freerouting or any GPL project; behaviour only.

## The layout file (decided)

`<name>.circuit.layout.json` beside `<name>.circuit.tsx`, one JSON record per line (JSON Lines), committed with the circuit:

- `{"t":"track","id":"t0001","net":"GND","layer":"top","width":0.25,"points":[{"x":1,"y":2},…],"locked":false,"by":"human"}` — points in mm, board coordinates, at least two; `by` is `human`, `agent` or `router`.
- `{"t":"via","id":"v0001","net":"GND","at":{"x":1,"y":2},"drill":0.3,"diameter":0.6,"layers":["top","bottom"],"locked":false,"by":"human"}`
- Ids are stable and never reused in a file; a missing file means no copper. The board outline, keepouts and copper zones stay in the TSX (`<board>` outline, `<keepout>`, `<copperpour>`), as the design says.
- The core treats the layout file like the circuit file: one history entry per change, undo restores the exact text, locks (`locked` on a record, or the part a track starts on) are honoured, and the agent's edits go through the same path.

## Task 1: the layout file in the core and the engine

- `src/core/layout-file.ts`: read, validate (zod-free, hand-written checks with clear messages) and write the layout file; edits `addTrack`, `setTrack` (points, width, layer, locked), `removeTrack`, `addVia`, `setVia`, `removeVia`; the next free id; a history entry per call that names the layout file; undo/redo through the existing workspace with the file-match rule.
- Engine: the PCB layout (`src/engine/pcb.ts`) gains `tracks` and `vias` from the layout file, resolved to nets by the pad or via they touch (a track that touches pads of two different nets is a `short` diagnostic; a track touching no pad keeps the `net` the record names and is reported `floating`). The ratsnest skips connections that copper already joins (pad to pad along tracks and vias, including a track that ends on another track of the net).
- Tests: read/write round trip; each edit; locks; undo; nets from copper; ratsnest reduction; short and floating diagnostics.

## Task 2: copper on the PCB canvas

- `studio/src/pcb/pcb-draw.ts` draws tracks (round caps and joins, layer colours from `PALETTE`, the inactive layer dimmed as EasyEDA does) and vias (ring in the plated colour, hole dark); the Layer panel's rows decide what shows; a track or via is picked like a wire (6 px reach, order: via, track, pad, part body), selected in white with the 50% wash, hovered with an outline; Properties shows net, layer, width, length, lock; Delete removes it; the Filter tab gets Tracks and Vias rows.
- Dragging a track segment moves it across its direction with its neighbours stretching (reuse `dragSegment`/`dragCorner` from the schematic wire shapes where the maths fits), ends stay on their pads; one history entry; live drawing during the drag.
- Tests: hit order, the drag edits, Properties rows, Delete.

## Task 3: the track tool

- Route → Single routing (`W` on the PCB, Alt+W as EasyEDA): click a pad to start on its net and layer, click corners, click a pad or a track of the same net to finish; `Space` switches the corner mode between 45° and 90° (preview follows); `V` (and the layer select) changes the active layer mid-route and places a via at the last corner; `Backspace` removes the last corner; `Esc` or a right click cancels. Width: the net class's width from `rules.yaml` when it has one, else the Design rules' default track width; the status line shows net, layer and width. A track ending on a pad of another net is refused with the two net names. One history entry per track (with its vias).
- Route → Via: click to place a via on the active layer pair; its net is the pad or track under it, else none (reported floating).
- Tests: the tool's state machine as pure data; the edits for a two-layer track with a via; refusals.

## Task 4: DRC on copper

- `src/engine/checks/drc-copper.ts`: clearance between copper of different nets (track–track, track–pad, via–pad, via–track) by the net classes' clearances and the class-to-class table, track width under the class or fabrication minimum, via drill and annular ring under the fabrication profile, copper to board edge, copper in keepouts; incremental on the changed objects with a spatial index (the existing one if there is one, else an R-tree from a permissively licensed library or a simple grid bucket).
- Violations get stable ids, positions and the items involved; the Studio draws them as today's markers; the checks list and `check_circuit` show them; "not routed yet" counts drop as copper joins connections.
- Tests: each rule with a minimal pair; the 200-part benchmark board with 400 tracks checked under 1 s (`test:perf`).

## Task 5: the agent's tools

- MCP: `route_track { file, net, layer, points, width? }`, `add_via`, `remove_copper { ids }`, and `copper_summary` (per net: tracks, vias, length, unrouted connections) in the compact style; `check_circuit` includes copper violations. INSTRUCTIONS: the model may draw copper for the connections it wants; the router (stage 5) does the rest later.
- Tests: tool shapes, one history entry, locks.

## Task 6: browser check (controller)

On the check copy: draw a two-layer track with a via between two pads, see the ratsnest line disappear; drag a segment; delete; undo; a clearance violation appears when a track is drawn too close to another net's pad; the Layer panel hides and dims layers; `copper_summary` through the MCP server.
