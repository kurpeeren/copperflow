# Studio UX round 6: schematic wires

Spec: `docs/studio-easyeda-parity.md` §7.1. Today a wire can only be drawn: once on the sheet it cannot be selected, dragged or deleted from the canvas, and a wire drawn with a corner off the axis of the previous point is saved as a slanted line although the preview showed right angles. This round makes wires behave as in EasyEDA Pro: what you draw is what is saved, a click selects a wire, dragging reshapes it, and wires follow the parts they join.

## Global constraints

The round 1–5 constraints hold: English in the repo; one-line commits with no trailers; no EasyEDA artwork; no "tscircuit" on screen; no new dependencies; `styles.css` must not grow; small functions and files; logic in tested `.ts` modules; keys by character (Turkish Q keyboard), Alt combinations by physical key; canvas keys follow the key-ownership rules R32–R34; `npm run typecheck`, `npm test` and `npm run build` pass. `src/engine/` and `src/core/` stay untouched: the core edits `addTrace`, `removeTrace` and `setTraceHints` already exist and keep their lock and read-only rules.

Facts:

- The engine draws a trace between two pins as `[pin end, ...schematicRouteHints, pin end]` with straight lines, or as one right-angle elbow when it has no hints (`src/engine/schematic.ts`, `drawPinToPin`). A trace from a pin to `net.X` with hints is drawn from the pin through its hints, and the net label sits on the last hint (`drawPinToNet`). Each such wire has `id: "wire:<connection id>"` and `connection`.
- For each named net, the engine also draws wires of its own between near pins that no trace joins (`src/engine/schematic-nets.ts`, `layoutNets`): `id: "wire:<net id>:<n>"`, no `connection`, one right-angle elbow between two pin ends.
- The W tool (`studio/src/pcb/use-wire-tool.ts`, `wire-tool.ts`) previews `rightAngles([start, ...corners, pointer])` but `wireEdits` writes only the clicked corners, so the engine joins them with straight lines. The demo's `R4.pin2 → Q1.pin2` wire shows the result: a slanted segment.
- `studio/src/pcb/label-drag.ts` already finds the source trace behind a hand-drawn label wire (`traceOf`) and writes `setTraceHints`; its blockers (read-only trace, corners written as an expression, locked parts, repeated names) are the ones wires need too.
- The selection (`studio/src/selection.ts`) holds part names only. Gestures start from `studio/src/pcb/press.ts` (`gestureStart`, `Under`) and run through `gestures.ts` / `use-canvas-gestures.ts`; group moves, nudges and align/distribute go through `group-edits.ts` and the TurnGate. The pick filter is `studio/src/pcb/pick-filter.ts`.
- The built-in browser pane is hidden at night, so canvases never draw there; the controller checks in Chrome.

## Task 1: save what was drawn

- `wireEdits` writes the corners of the path the preview shows: the interior points of `rightAngles([start, ...corners, end])`, with repeated points and points in the middle of a straight run dropped, rounded to 4 decimals. A net end keeps its point as the last corner, as today. A wire with no bend needed writes no hints.
- `Space` while a wire is being drawn flips the bend of the leg to the pointer (horizontal first ↔ vertical first); the preview, the pending dashed wire and the saved wire follow it. A click that places a corner keeps that leg's bend. When no wire is being drawn, `Space` keeps its job (rotate). Help → Keys lists it.
- Tests: the saved corners for an off-axis corner (the demo case gives only horizontal and vertical segments); collinear and repeated points dropped; a net end; the flip, in the preview and in the edit; the key map.

## Task 2: wire shapes (pure module)

New `studio/src/pcb/wire-shape.ts`, no React:

- `wireOf(design, source, wireId)`: the wire's points, which ends are fixed (pins and the label end of a pin-to-net wire), and what writes it: a source trace (its `from` and `to` as written, so the corners can be written in its order; the n-th trace for a `#n` connection) or, for a wire the engine drew on its own, the net and its two pins.
- `dragSegment(path, index, delta)`: a horizontal segment moves only up or down, a vertical one only left or right; its neighbours stretch; a segment that touches a fixed end gets a new segment at that end so the end stays put; a slanted segment (old files) moves by the whole delta.
- `dragCorner(path, index, to)`: moves a corner; both its segments stay horizontal or vertical (it is the two neighbouring segment drags together), with the same fixed-end rule.
- `removeCorner(path, index)`: drops a corner and squares the path again.
- `tidy(path)`: drops repeated points and points in the middle of a straight run, rounds to 4 decimals.
- `wireShapeEdits(design, source, wire, path, locked)`: `setTraceHints` with the interior points in the trace's own order; for an engine-drawn wire, `addTrace` between its two pins with those points as hints (connectivity does not change: both pins are on the net already). Nothing when the shape did not change. Blockers, as label drag words them: read-only trace, corners written as an expression, a locked part at either end, a repeated part name.
- Check before writing it: that a second trace between two pins already on one named net changes nothing in the netlist, the PCB ratsnest or the checks. If it does, say so in the report and make engine-drawn wires refuse to reshape with a reason instead.
- Tests for every function above, including fixed ends, slanted segments, a pin-to-net wire and an engine-drawn wire.

## Task 3: select, delete and see a wire

- The selection holds either parts or one wire, in one place (one source of truth): a click on a wire selects that wire and clears the parts; a click on a part clears the wire; `Esc` clears both. `Ctrl+A` still selects parts.
- Hit test: within 6px of a wire's segment, under the pointer's other rules: a net label wins over a wire, a wire wins over a part body. The Filter tab gets a Wires row on the schematic (on by default) that it obeys.
- Drawing: a selected wire in the spec's selected colour (`#FF0000`) with square handles on its corners (ends drawn as hollow squares, not draggable); a hovered wire outlined, as a hovered part is.
- Properties: a Wire section for the selected wire: net (with Highlight), from, to, number of corners, and whether the wire is a trace or drawn by Studio on its own; buttons Remove corners and Delete.
- `Delete` (key, Edit menu, context menu, Properties) removes the selected wire's trace in one history entry. An engine-drawn wire says it has no trace of its own and which net draws it. Read-only and locked wires give their reason.
- Context menu on a wire: Properties, Highlight net, Remove corners, Delete.
- Tests: the hit-test order, the filter row, the Properties rows, the delete edits and reasons, the context-menu items.

## Task 4: drag to reshape

- A left press on a pickable wire and a drag past 3px drags the segment under the pointer (`dragSegment`), selecting the wire; a press on a corner handle of the selected wire drags that corner (`dragCorner`). The new shape is drawn live, snapped to the Grid step while Snap is on, and on release `wireShapeEdits` goes out through `actions.edit` in one history entry; the wire stays selected. `Esc` during the drag cancels it. A blocked wire shows the reason and writes nothing.
- A double click on a corner handle removes the corner (one history entry); a double click elsewhere on a wire selects it and opens Properties on its Wire section.
- The reshaped wire is drawn in its new shape until the build that includes it arrives, as the W tool does with its pending wires.
- The gesture rules stay in `press.ts` as pure data: `Under` and `gestureStart` gain the wire and the corner handle.
- Tests: the gesture rows, the edits sent for a segment drag and a corner drag, cancel, blocked, the double clicks.

## Task 5: wires follow moved parts

- In the shared move path (dragging parts, arrow-key nudges, align and distribute), every trace with corners that ends on a pin of a moved part keeps its first segment from that pin horizontal or vertical: the corner next to the pin moves with it along the segment's cross direction (a horizontal first segment: the corner's y moves by the pin's dy; a vertical one: its x by dx). When both ends of a trace move by the same delta, all its corners move by it. The corner edits ride in the same `actions.edit` call as the move, so it stays one history entry.
- Traces that are read-only or whose corners are an expression are left as they are; the move still happens.
- Rotation is not covered in this round.
- Tests: one end moved (horizontal and vertical first segments), both ends moved, a pin-to-net wire, a read-only trace, the single history entry.

## Task 6: parts and wires in one selection

Asked by the user after Task 3 (2026-11-09): a box over parts and wires selects only the parts, and Shift+click does not add a wire. In EasyEDA a selection holds any objects. This task replaces Task 3's "parts or one wire, never both" rule.

- The selection holds part names and wire ids together, each kept in pick order; the part counts and part commands keep meaning parts, and "Selected objects: N" counts both.
- Shift+click or Ctrl+click toggles a wire in or out, as for parts. A plain click on a wire selects it alone.
- A box selects wires too, by the same direction rule as parts: left to right takes wires fully inside the box, right to left takes wires it touches. The Filter's Wires row still decides whether wires can be picked. `Ctrl+A` on the schematic selects every part and every wire.
- Properties with parts and wires: the counts by kind, and the actions that apply to all (Delete; Rotate, Lock and Unlock act on the parts).
- `Delete` removes the selected parts and the selected wires' traces in one history entry. A wire whose trace ends on a part being removed is left to the part (core's `removePart` already removes its traces), so no edit is sent twice. Wires that cannot be deleted are named and the rest go ahead, as for locked parts.
- Dragging a selected part or a selected wire moves the whole selection: parts move as today (wires follow, Task 5); a selected wire whose two end parts both move moves with them; a selected wire whose ends stay moves its corners by the drag with jogs at its ends (`dragSegment`'s fixed-end rule), all in one history entry. Arrow-key nudges do the same.
- Tests: the selection helpers with mixed contents; box selection of wires in both directions; Ctrl+A; the Delete batch (dedupe, refusals); the mixed move edits.

## Task 7: browser check (controller)

In Chrome on the demo: draw a wire with an off-axis corner and see right angles after the build, flip with Space; click, hover and double-click a wire; drag a segment and a corner (neighbours stretch, ends stay on pins); remove a corner; delete a wire and undo; reshape an engine-drawn wire; move a part and see its wires follow; the Filter row; a box over parts and wires, Shift+click a wire, Delete and move a mixed selection. Fix what fails before the round ends.
