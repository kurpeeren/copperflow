# Perfboard and stripboard

Asked by the maintainer (2026-11-24): quick builds, such as 24 V relay modules with terminal blocks, are often made on
perfboard or stripboard instead of a made PCB. copperflow should design those too: parts and modules placed on the
2.54 mm hole grid, their connections drawn as solder paths, and a picture and lists to build from.

## Global constraints

The repository's constraints hold (English; one-line commits without trailers; small tested modules; typecheck, test
and build pass; `src/engine/` deterministic and offline; files as LF). No new dependency. No new MCP tool: the tool list
is capped in `test/tool-schemas.test.ts` and had about 450 characters to spare, so new options are few and short and
the detail goes into a guide topic.

## Words

- **Perfboard**: a grid of 2.54 mm holes, each with its own copper pad on the bottom. Neighbouring pads are joined by a
  run of solder (a solder bridge) or by bending a lead across.
- **Stripboard**: a grid of 2.54 mm holes joined along one direction by copper strips. A strip is cut to separate it.
- **Link**: an insulated wire on the top side between two holes in one row or column (a jumper, designator W).
- **Hole names**: rows are letters from the top (A, B, …, Z, AA, …), columns numbers from the left (1, 2, …); "C7" is
  row C, column 7. The names read the same on both sides; the bottom picture is mirrored as the board is when turned.

## Board model

`<board kind="perfboard" columns={30} rows={20} />`, or `kind="stripboard"` (strips along the rows; `strips="columns"`
turns them). The pitch is 2.54 mm. The outline is `columns × 2.54` by `rows × 2.54` mm round the board's centre
(`pcbX`, `pcbY`), so the outer holes lie half a pitch from the edge; `width`/`height`/`outline` on such a board are
ignored with a warning. The engine's `Board` gains `proto: { kind, columns, rows, pitch, first, strips? }` where `first`
is the centre of hole A1.

A part sits on the grid when every one of its through-hole pads lies within 0.25 mm of a hole (a lead bends that far).
`check_circuit` reports:
- `proto-smd` (error): a part with surface pads cannot go on perfboard or stripboard; use a through-hole footprint.
- `proto-off-grid` (error): "K1 pin 3 is 0.46 mm from hole D9; its pins are not 2.54 mm apart, so it cannot sit on the
  grid", naming the nearest hole and the distance.
- `proto-hole-shared` (error): two pads in one hole.
- `proto-outside` (error): a pad outside the grid.

The placer snaps: on a proto board, `autoplace` (and `new_circuit`, which calls it) moves each placed part so that its
first pad lies on a hole, at a quarter turn, nearest where the placer put it and clear of the parts snapped before it.

## Paths (the layout file)

Three new record kinds in `<name>.circuit.layout.json`, beside the copper and the reference images, written and undone
as one history entry like the rest:

- `{"t":"solder","id":"s1","net":"GND","holes":["C3","C4","D4"],"locked":false,"by":"router"}` — a run of solder along
  neighbouring holes (each step one hole across or down), on the bottom.
- `{"t":"link","id":"w1","net":"GND","from":"C3","to":"C9","locked":false,"by":"router"}` — a wire on the top, straight
  along a row or a column, soldered at both ends.
- `{"t":"cut","id":"x1","at":"C7","by":"router"}` — the strip drilled away at a hole (stripboard), or
  `{"t":"cut","id":"x2","between":["C7","C8"]}` — cut with a knife between two neighbouring holes when no hole is free.

What joins what (`src/engine/proto/joins.ts`, one union-find over the holes): a pad joins its hole; a solder run joins
its holes; a link joins its ends; on stripboard each hole joins its neighbour along the strip unless a cut is at either
hole or between them. The islands it makes feed the ratsnest, so the Studio's airwires, `check_circuit`'s unrouted list
and the router all see the same connections as on a PCB.

## Router

`autoroute` on a proto board runs `src/engine/proto/route.ts` instead of the PCB router: an A* search on the hole
lattice, one net at a time, growing each net's tree from its first pad to the nearest pad not yet joined.

- Moves run only along grid lines between holes. Perfboard: one hole across or down costs 1 (solder). Stripboard: a
  step along the strip costs almost nothing (the copper is there), a step across a strip is not allowed.
- A link jumps straight along a row or column over two or more holes (one or more on stripboard, across the strips),
  costing as much as six solder steps plus a little per hole, so a link is used where it saves a long detour or where
  paths would otherwise cross.
- A hole belongs to at most one net. A link may not pass over a hole holding a lead or over another link, so links
  never touch each other or the parts' legs.
- On stripboard a hole between two holes of one net on the same strip carries that net; between two different nets a
  cut is needed. After routing, each strip gets one cut per change of net, at the free hole nearest the middle of the
  gap, or between the holes when they are neighbours. Cuts already there are kept; the router adds only what is missing.
- Nets are routed shortest first; a net that fails is tried again first in the next round (up to four rounds), and the
  round with the fewest failures, then fewest links, then shortest solder is kept. Hand and locked records stay.
- The answer counts solder runs, links and cuts and names each connection it could not join.

## What a person gets

- `render { view: "board", side: "top" | "bottom" }` on a proto board draws the board as built: the hole grid with row
  letters and column numbers, the strips and their cuts (stripboard) or the pads and solder runs (perfboard), the links
  on top (and their ends on the bottom), the parts' outlines and designators on top. The bottom is seen from below.
- `export { as: "build" }` writes a build sheet (`<name>-build.md`) with both pictures: the parts and the holes their
  pins go in, the link list (`W1 GND C3 to C9, 15.2 mm`), the cut list (`X1 at C7`) and, on stripboard, what each strip
  carries (`Strip C: 1–6 GND | cut | 8–30 V24`). `autoroute`'s answer ends with the counts.
- `check_circuit` adds, besides the placement findings above:
  - `proto-open` (warning): a net whose pins are not all joined yet ("net GND: J1.pin2 and K1.pin5 are not joined").
  - `proto-short` (error): two nets joined by solder, a link or an uncut strip ("C3–C12 joins GND and V24: cut the
    strip between them").
  - `proto-cut-splits` (error): a cut that parts holes of one net that nothing else joins.
  - `proto-link` (error): a link not straight, over a lead or over another link, or ending outside the grid.
  - `proto-solder` (error): a solder run with a step that is not to a neighbouring hole.
  - `proto-record` (warning): a cut on perfboard, or a record's net that differs from the pads it joins.

## MCP and Studio surface

No new tool:
- `new_circuit { board: { kind: "perfboard" | "stripboard", width?, height? } }` writes a proto board (the size rounded
  up to whole holes; fitted round the parts when no size is given).
- `fit_board { kind }` turns a board into perfboard, stripboard or back into a PCB; fitting round the parts counts whole
  holes plus one free hole all round.
- `autoroute`, `render`, `check_circuit` as above; `export { as: "build" }`.
- `guide { topic: "perfboard" }` holds the worked detail; SKILL.md points to it.
- Studio: the PCB view of a proto board draws the hole grid, strips, cuts, solder runs and links from the design,
  through the same drawing code the PCB render uses. Editing them by hand in the Studio is left for a later round.

## Tasks

1. Board model, hole names, grid snapping and the placement checks (`src/engine/proto/grid.ts`, `checks.ts`).
2. Records in the layout file and the joins; the ratsnest on proto boards (`src/core/layout-proto.ts`,
   `src/engine/proto/joins.ts`).
3. The router, its cut placing and the writes (`src/engine/proto/route.ts`, `cuts.ts`, `src/core/proto-writes.ts`).
4. The board picture and the build sheet (`src/engine/proto/picture.ts`, `build-sheet.ts`).
5. The tool surface: new_circuit, fit_board, autoplace snapping, autoroute, render, export; the guide topic.
6. Proof: one small module, a relay driver (terminal block, transistor, resistor, diode, LED, relay), built on both
   perfboard and stripboard from `new_circuit`, placed, routed, checked and rendered, as an end-to-end test and an
   example in `examples/`.

Left for later: hand editing of solder, links and cuts in the Studio; tinned wire runs on the bottom as an alternative
to solder bridges; diagonal component leads; boards with a different pitch.
