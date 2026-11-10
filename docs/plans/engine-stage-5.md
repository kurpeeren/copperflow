# Engine stage 5: the router

Design: `docs/engine-design.md` §8 (the router), §7 (copper and the layout file), §9 (rules and checks). Stage 4 gave hand-drawn copper, the copper nets, the ratsnest reduction and the DRC on copper; stage 6 gave pages and sub-sheet instances. This stage gives the router that draws what the ratsnest still misses, for a person (Route → Autoroute) and for the agent (`autoroute`). The first real board is the CAN module made on 2026-11-10 (`can-module.circuit.tsx`: MCP2515, TJA1050, 12 parts, 15 nets, 32 connections on a 42 × 28 mm two-layer board), which must route clean.

## Global constraints

The repository's constraints hold (English; one-line commits without trailers; no new dependencies; small tested modules; typecheck, test and build pass; `src/engine/` deterministic; nothing a person placed or drew is moved by the engine). Licence rule: no code from KiCad, Freerouting, or any GPL project; the published ideas (A* on a grid, negotiated-congestion rip-up and reroute as in PathFinder) are used, not their code. Everything the router writes goes through `src/core` as layout edits with `by: "router"`, one history entry per run, and respects locks and hand-made copper (`by: "human"` or `"agent"` records are obstacles, never moved or removed).

## Decisions

- **Grid.** The router works on a square grid over the board with 8-neighbour moves (orthogonal and 45°). The pitch comes from the rules: half of the smallest (track width + clearance) among the net classes, rounded to 0.05 mm, kept within 0.05–0.25 mm. Obstacles are rasterised grown by the clearance the pair of classes needs, so a path's centreline is legal wherever the grid is free. The final DRC on copper (stage 4) is run on the result in tests; the router's output must pass it with zero violations on every test board.
- **Layers and vias.** Two-layer boards route on top and bottom; a four-layer board adds inner1 and inner2 (only the layers `board.layers` has). A via costs as much as a run of about 20 grid steps, so the router prefers staying on a layer; via drill and diameter come from the net class as in stage 4. Vias never land inside pads of other nets or keepouts, and through-hole pads are obstacles on every layer.
- **What is routed.** Everything the ratsnest still misses, or one net, or the connections of the selected parts, or one sub-sheet instance (then the same route is replicated to the other instances of that sheet when their placement matches, as Replicate layout does). Existing copper of a net is a target: a connection may end on a track or via of its net.
- **Order and negotiation.** Nets are routed shortest connection first; when two nets want the same cells, negotiated congestion (a cost that rises each pass on contested cells) resolves it over at most 30 passes; what is still contested is reported "could not route A to B: no room between X and Y" with the pins and the obstacles, and the rest of the result is kept.
- **Cleanup.** After routing: redundant corners removed, staircases turned into 45° runs, vias removed where a single-layer path exists, track ends snapped to pad centres; cleanup never creates a violation (it is checked by the same rasteriser).
- **Running.** In the Studio the router runs in a worker thread of the server (`node:worker_threads`), reports progress (nets done, total, current pass) through the live events, can be cancelled, and discards its result if the circuit or the layout file changed while it ran (compared by content hash at start and end). The agent's tool runs the same code in-process with a time budget (default 20 s) and returns the compact report.
- **Determinism.** Same input, same output, twice; no randomness; ties broken by net name and pin id.

## Task 1: the grid and one net

- `src/engine/router/grid.ts` (the board rasterised: cells per layer, obstacles from pads, copper of other nets, keepouts, the board edge clearance; the pitch rule), `src/engine/router/astar.ts` (one connection between two cell sets on one or two layers with 8-neighbour moves, corner and via costs, a bounded open set), `src/engine/router/path.ts` (a cell path to track points and vias in mm, snapped to the grid). Pure, deterministic, tested on small boards: two pads with a part in the way (the path goes round), a path that must change layer (one via), a connection ending on existing copper of the net, no path when the board is full (a reason naming the blocking objects).
- Tests also run the stage 4 DRC on every routed result: zero violations.

## Task 2: all nets, with negotiation

- `src/engine/router/route-board.ts`: the whole job — the connections the ratsnest misses (from stage 4's copper nets), ordering, the negotiated-congestion loop with a pass cap, the report (routed, unrouted with reasons, passes, time). Scope options: all, nets, parts, instance.
- Performance test (`npm run test:perf`): the CAN module board routes fully in under 2 s; the 200-part benchmark board with 400 connections in under 30 s.
- Tests: two nets that cross must both route (one takes the other layer); a net that cannot route is reported and the others still are; determinism (twice the same); the instance scope and its replication.

## Task 3: cleanup

- `src/engine/router/cleanup.ts`: corner removal, 45° smoothing, via removal, end snapping, each checked against the rasteriser; the output is the layout edits (`addTrack`/`addVia` with `by: "router"`) as one list.
- Tests: each cleanup step on a minimal path; a cleaned result still has zero DRC violations; cleanup is idempotent.

## Task 4: the Studio and the server

- Server: the router in a worker (`src/studio/router-worker.ts`), started by `POST /api/route { file, scope }`, progress and completion through the live events, `POST /api/route/cancel`; the result applied through `applyLayoutEdits` as one entry with `by: "router"`, author `human`; discarded when the content hash changed.
- Studio: Route → **Autoroute** (all), Route → Autoroute selection (the selected parts' connections, or the selected instance), Route → Autoroute net (the Net panel's row), Route → **Unroute** (removes router copper only — the selection's, or all), a progress line in the status bar with Cancel, the ratsnest dropping as the result lands; the Checks list shows the unrouted reasons. Locked parts' pads are never touched; hand copper is an obstacle.
- Tests: the route request and event shapes, the hash discard rule, the menu items and commands, Unroute's record filter.

## Task 5: the agent's tools

- MCP: `autoroute { file, nets?, parts?, instance?, budgetSeconds? }` and `unroute { file, nets? | all }`, compact answers ("Routed 30 of 32 connections in 2 passes; unrouted: U1.pin3 to R1.pin2 (no room between U1 and C3), …"); INSTRUCTIONS and SKILL.md: place first, then autoroute, then check_circuit; hand-route only what the router reports.
- Tests: tool shapes, one history entry, locks, the budget.

## Task 6: browser check (controller)

On the check copy with the CAN module: Route → Autoroute routes every connection, the ratsnest is empty, the DRC shows zero copper violations, undo removes the whole run as one step; Unroute leaves hand-drawn tracks alone; `autoroute` through the MCP tool gives the same result.
