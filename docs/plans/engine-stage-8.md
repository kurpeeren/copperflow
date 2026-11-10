# Engine stage 8: copper pours and holes

Design: `docs/engine-design.md` §7 (copper zones stay in the TSX as design intent, `<copperpour>`), §9 (checks), §10 (outputs). Stage 7 made a routed board manufacturable, but the two things every real board has are still missing: a ground pour and mounting holes. `<copperpour>` and `<hole>` are parsed as "later stage" and dropped today. This stage fills pours deterministically from the design intent, checks them, draws them, exports them, and lets both a person and the agent place them.

## Global constraints

The repository's constraints hold (English; one-line commits without trailers; small tested modules; typecheck, test and build pass; `src/engine/` deterministic; nothing a person placed is moved; files as LF). One new **runtime** dependency is allowed for this stage, as the design permits for geometry: a permissively licensed polygon clipping and offsetting library (the Boost-licensed `clipper-lib` port, or an MIT equivalent that offers boolean operations and offsets; check the licence file, note it in `docs/licences.md`; never GPL). No code from KiCad or other GPL tools.

## Decisions

- **The pour is design intent; the fill is computed.** `<copperpour net="GND" layer="bottom" />` fills the whole board (the outline shrunk by the board-edge clearance); `<copperpour net="GND" layer="top" outline={[{x,y},…]} />` fills a drawn polygon. Optional props: `priority` (higher wins where pours overlap, default 0), `clearance` (mm, default the net class's clearance), `minWidth` (mm, default 0.25: copper narrower than this is removed), `thermal` (`"relief"` default, or `"solid"`), `thermalWidth` (spoke width, default 0.3), `thermalGap` (default 0.25). The fill is never written to a file; the engine computes it on every build from the pour, the pads, the copper, the keepouts and the outline, deterministically, and caches it by an input hash so an unchanged board costs nothing.
- **What the fill avoids.** Other nets' pads and copper grown by the clearance; keepouts on the layer (or `all`); holes grown by the board-edge clearance; the board edge by its clearance; other pours of higher priority grown by the clearance. Same-net through pads and SMD pads get a thermal relief (four spokes at 0°/90°, `thermalWidth` wide, `thermalGap` between pad and copper) unless `thermal="solid"`; same-net tracks and vias are joined solid. Islands not touching any same-net pad, via or track are removed. Then a morphological open with `minWidth` removes slivers.
- **It is copper.** The fill joins its net in `copper.ts` (so the ratsnest drops for connections the pour makes — GND pins joined by the pour are routed), it is a copper piece for the DRC (clearance to other nets by construction; the check still runs as the safety net), the router treats a pour as free space (the fill recomputes around new tracks) but reports connections the pour already makes as routed, Gerber writes it as `G36/G37` regions (with the reliefs cut out, as polygons with holes written as separate regions or with the hole as a cut-in), and the mask/paste ignore it.
- **Holes.** `<hole x y diameter />` is a non-plated hole: drawn on both sides, kept clear of copper by the board-edge clearance (a DRC `copper-hole` violation when copper comes closer), written to `-NPTH.drl`, an obstacle for the router and the pour.
- **Performance.** The CAN board with a GND pour on both layers fills in under 200 ms; the 200-part benchmark with two pours in under 3 s (perf test).

## Task 1: the model, the fill and holes

- `src/engine/model.ts` / `elaborate.ts`: `<copperpour>` and `<hole>` parsed and validated (net exists, layer in `board.layers`, outline inside the board, sizes positive); `src/engine/pour/fill.ts` (the boolean pipeline above on the clipping library), `pour/thermal.ts` (the relief shapes), `pour/islands.ts`, `pour/cache.ts`; the design carries `pcb.pours[] = { id, net, layer, polygons: [{ outer, holes }], area }` and `pcb.holes[]`.
- Tests: a whole-board pour on an empty board equals the shrunk outline; a pad of another net leaves a clearance gap; a same-net through pad gets four spokes of the right width and gap; `solid` joins fully; a keepout and a hole are cut; an island without a same-net contact is removed; slivers under `minWidth` go; priority between two pours; determinism; the perf bounds.

## Task 2: nets, checks, router and outputs

- `copper.ts`: pours join their net (contact by geometry with pads, tracks and vias); the ratsnest skips connections the pour makes. `drc-copper.ts`: pour pieces in the clearance checks; `copper-hole` for any copper near a hole. Router: holes as obstacles; pour-made connections not routed; the pour recomputed after a route. Gerber: regions with reliefs, tested by parsing back (area within 1% of the model's).
- Tests: a GND pin pair joined only by the pour counts as routed; a track of another net through the pour area makes the fill retreat (no violation); a hole violation; the CAN board with a bottom GND pour routes with fewer tracks than without (the GND connections go to the pour); Gerber round trip.

## Task 3: the Studio

- Place → **Copper pour** (draw a polygon as the drawing tools do, or Place → Copper pour → Whole board), Properties for net, layer, priority, clearance, minWidth, thermal; the pour's outline selectable, its vertices draggable (writes the outline), Delete removes it; the fill drawn solid with 35% alpha (View → Pour fill: solid / hatched / outline only); the Layer panel lists pours per layer; the hover label names the pour (`pour GND · bottom`); Place → **Hole** with a diameter field.
- Tests: the tool's edits, the Properties rows, the pick order (pour after tracks), the view toggle.

## Task 4: the agent's tools

- `add_pour { file, net, layer, outline? , props? }`, `remove_pour`, `add_hole`; `new_circuit` accepts `pours` and `holes`; `copper_summary` reports pours (net, layer, area, connections made); `check_circuit` includes `copper-hole`. INSTRUCTIONS: a two-layer board gets a GND pour on the bottom (and top when there is room) before autoroute.
- Tests: tool shapes, one history entry, locks (a pour is never locked by a part lock; `lock` applies to it by id), the summary.

## Task 5: proof (controller)

The CAN module with a GND pour on both layers: autoroute, DRC zero, the ratsnest empty with fewer GND tracks, the Studio shows the fill with reliefs, the export's Gerber shows the regions, the zip handed to the maintainer.
