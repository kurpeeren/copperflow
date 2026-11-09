# Studio UX round 8: schematic drawing tools and buses

Asked by the user (2026-11-09): neither canvas has EasyEDA's design tools, such as drawing lines or placing a bus. This round gives the schematic EasyEDA's drawing tools (polyline, rectangle, circle, arc, text) and the bus. The PCB's tools (tracks, vias, board outline, copper areas) are engine stage 4, "Hand routing" (`docs/engine-design.md` §7, §11), and get their own plan after this round.

Today the engine knows parts, `board`, `group`, `trace` and `keepout`; any other tag is an error, and `via`, `hole`, `copperpour`, `port` and `netlabel` are accepted with a warning and ignored (`src/engine/elaborate.ts`). The core's edits are `addPart`, `removePart`, `setProps`, `addTrace`, `removeTrace` and `setTraceHints` (`src/core/types.ts`). So drawings need new elements in the engine, new edits in the core, and tools in the Studio.

EasyEDA, as measured (`docs/plans/studio-ux-5.md`): Place → Bus (`Alt+B`), Polyline (`Alt+L`), Arc (`Alt+A`), Circle (`Alt+C`), Rect (`Alt+R`), Text (`Alt+T`), with Bezier, Ellipse, Image and Table beside them. Drawings carry a line width, a line style and a colour in Properties.

## Global constraints

The round 1–7 constraints hold: English in the repo; one-line commits with no trailers; no EasyEDA artwork; no "tscircuit" on screen; no new dependencies; `styles.css` must not grow; small functions and files; logic in tested `.ts` modules; keys by character (Turkish Q keyboard), Alt combinations by physical key; canvas keys follow the key-ownership rules; `npm run typecheck`, `npm test` and `npm run build` pass. `src/engine/` and `src/core/` may change in this round, for the tasks that say so, keeping the lock, read-only and history rules.

## The file format (decided)

Drawings are elements in the circuit file, in sheet units (1 = 1 inch, y up), each with an optional `name` the agent can address and the Studio writes as `G1`, `G2`…:

- `<schematicpath points={[{ x, y }, …]} />`: a polyline of two or more points.
- `<schematicrect x y width height />`: a rectangle by its lower-left corner.
- `<schematiccircle x y radius />`
- `<schematicarc x y radius startAngle endAngle />`: degrees, counter-clockwise from +x.
- `<schematictext x y text fontSize anchor />`: `anchor` one of `left`, `center`, `right`.
- Shared optional props: `strokeWidth` (sheet units, default 0.01), `lineStyle` (`solid`, `dashed`, `dotted`), `color` (`#RRGGBB`, default the theme's drawing colour), `filled` (rect and circle).
- `<bus name="D[0:7]" points={[…]} />`: a bus line with its name. A bus does not join nets: wires that end on a bus are written as a trace from the pin to `net.<member>` with the label where the wire meets the bus (EasyEDA joins bus members by net names the same way).

Drawings belong to the schematic only; the PCB ignores them. They inherit a group's offset like parts do.

## Task 1: drawings in the engine

- `elaborate.ts` accepts the six tags above; they become `drawings` in the model with their kind, props, name (or an index-based id when unnamed) and source; unknown props or bad values give the usual diagnostics (no silent skips).
- `layoutSchematic` passes them through as `SchematicLayout.drawings` in sheet coordinates (group offsets applied); `drawingExtents` (Studio) and the sheet size include them.
- Tests: each tag read, defaults, bad values reported, a group offset applied, the layout output.

## Task 2: drawing edits in the core

- New edits: `addDrawing { tag, props, name? }` (inserted before the board's first trace, like `addPart`; the Studio names it `G<n>`), `removeDrawing { name }`, and `setProps` extended to drawings by name (moving one is a `setProps` of its coordinates or points). Locks: a drawing can be locked by name like a part. Read-only rules: a drawing whose props are expressions is read-only, as for parts.
- History and undo work unchanged (one history entry per call); the MCP tools learn the new edits only if it falls out of the shared edit path (no new MCP tool shape this round).
- Tests: add, remove, move a drawing; a locked or read-only drawing refused; history and undo.

## Task 3: drawings on the canvas

- The schematic draws drawings in the theme's drawing colour (a new `schematicTheme.drawing`, `#000080` unless set), with their stroke width (never under one device pixel), line style and fill; text in the canvas font.
- Selection: drawings join the selection like parts and wires (the selection model from round 6 Task 6): click, Shift/Ctrl+click, box (by direction), Ctrl+A, the Filter tab (a Drawings row), hover outline, the selected colour, Properties (kind, position, size or points, stroke width, line style, colour, fill, text and font size, editable as fields), Delete, drag to move (one history entry), arrow nudges, the context menu (Properties, Delete).
- Tests: hit testing per kind, box selection, the Properties rows and their edits, the move edits.

## Task 4: the drawing tools

- Place → Polyline (`Alt+L`), Rectangle (`Alt+R`), Circle (`Alt+C`), Arc (`Alt+A`), Text (`Alt+T`), on the toolbar too, in EasyEDA's order. Each tool stays armed until `Esc` or a right click, like the label tools.
- Polyline: click to start, click for each corner, double click or `Enter` to finish, `Backspace` removes the last corner, `Space` flips the bend while `Shift` is held for right angles (without `Shift`, any angle, as EasyEDA allows). Rectangle: press-drag or click-click by two corners. Circle: centre then radius. Arc: centre, start, end. Text: click to place, then type in a small inline field; `Enter` writes it.
- Points snap to the grid while Snap is on. One drawing = one history entry.
- Tests: each tool's state machine as pure data (clicks → points → the `addDrawing` edit), Esc and Backspace.

## Task 5: the bus

- Place → Bus (`Alt+B`) draws a bus like a polyline (in the spec's wire and bus colour `#008800`, three times a wire's width) and asks for its name in an inline field (`D[0:7]` style; a plain name is a one-member bus). It writes `<bus name points>`.
- The W tool can end a wire on a bus: it offers the bus's members (`D0`…`D7`) in a small list at the pointer; picking one writes the trace from the pin to `net.D3` with the label on the bus, with the wire's corners as hints. A wire that starts on a bus works the same way the other way round.
- The bus can be selected, moved, deleted and renamed like a drawing (renaming changes only the bus; the members' wires keep their nets).
- Tests: the member list from a name (`D[0:7]`, `A[3:0]`, `CLK`), the wire edit to a bus member, the bus edits.

## Task 6: browser check (controller)

On the copy of the demo (port 4779): draw each kind, select and move and delete them, change their Properties, undo; draw a bus, wire two pins to two members, check the nets in Properties and the labels; the Filter row; both canvases at 110%. Fix what fails before the round ends.
