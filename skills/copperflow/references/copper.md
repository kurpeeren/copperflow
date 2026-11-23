# Copper: placing, routing, pours and holes

Read before you place or route a board, or draw copper by hand.

## The board from a drawing

When the person has put a `.dxf` in the project folder, `import_board` `{ file, dxf }` first, then
`render` to look, then place. One change: the largest closed shape is the outline (centred on the
origin; `origin: "keep"` leaves it as drawn), circles inside it are mounting holes, other closed
shapes inside it become keepouts on all layers (not cut out of the board). It answers
`Change c0003: board outline from enclosure.dxf: 12 corners, 82 x 54 mm (drawing in mm, moved by
-41, -27)`, then the holes, the keepouts and `Not used: 2 SPLINE, …`. `layer` picks the outline's
layer when the largest shape is not the board; `units` overrides the file's; a board that has holes
or keepouts already needs `replace: true`. Placed parts stay; the answer names those now outside.
An `.svg` goes in the same `dxf` field (CLI `copperflow board <file> --svg <path>`): its width and height
must be physical (`60mm`, `2in`), as a board has real dimensions; the largest closed shape (a filled
area's ring or a closed line) is the outline, a circle inside it a hole, another closed shape a keepout.
An SVG has no layers, so `layer` and `units` are refused; an open path is not an outline.

A KiCad board (`.kicad_pcb`, saved by KiCad 6 or newer, two copper layers) goes in the same tool:
`import_board` `{ file: "new.circuit.tsx", dxf: "old.kicad_pcb" }` writes `file` as a new circuit in one
change: the outline from Edge.Cuts, every footprint as a placed part (one library part per land
pattern, pin list and value, never verified), the nets, tracks, vias and pours. It builds and checks
the result and answers what it wrote against what the file held, whether every pad kept its net, and
a list `Not carried over:` by kind and count (silkscreen, texts, 3D models, rules, …). Tell the person
the parts must be compared with their datasheets before they are verified.

## Placing and routing

Copper: place the parts first with `autoplace` (one history entry; parts without a position, or
only some `parts` or an `instance`; `fit: true` also fits the board; it answers "Placed 12 parts;
wire length 184 mm (was 412); board 42 × 28 mm; 0 overlaps", then any part not placed), then run
`autoroute` (one history entry; it routes what is still unrouted, or only some `nets`, `parts` or
an `instance`, within `budgetSeconds`, 20 s by default, and names each connection it could not
route with the reason), then `check_circuit` once at the end (filter `copper` for the full list).

Connectors go on the board edge nearest the parts they serve, pins inward. To choose the edge (input
on the left, output on the right), give the part `pcbEdge`: `set_props` `{ pcbEdge: "left" }` (left,
right, top or bottom; the board is y up, so top is the largest y). Any part with `pcbEdge` goes
against that edge, a connector or not (an LED or a switch at the front). With no room there it goes
on another edge and the answer's `Notes:` say so; `null` removes the choice.

On a crowded board, when placing by connections leaves a part with no room, `autoplace` packs the
parts against each other and the board edges until they all fit (`Notes: The parts did not all
fit by their connections, so they were packed …`). The wire is then longer: look at the board with
`render`, and move a part with `set_props` where a short loop matters (a regulator's input
capacitor beside its input pin).

One `autoplace` over the whole board is right for a small board (a dozen or two parts on one
sheet). A board with sub-sheets is laid out the way a person does it, blocks first:

1. Each sheet's first instance on its own: `autoplace` `{ file, instance: "CH1" }` answers
   `Placed 4 parts; …`. Its parts are packed tight, turned so the pads of a shared net face each
   other; the unplaced parts of the rest of the board are not in its way. A sheet holds one layout
   for all its instances, so the other copies sit on it for now.
2. Its inside routed on its own: `autoroute` `{ file, instance: "CH1" }` answers
   `Change …: Routed 4 of 4 connections in 1 pass`. Copies still sitting on it get no copy of the
   route and show as a `short` until the board is placed; copies already placed the same way
   elsewhere get the route copied.
3. `render` `{ file, parts: ["R101", "C101"] }` to look at the block.
4. The board: `autoplace` `{ file, fit: true }`. Connectors go on the edge nearest the blocks they
   serve, pins inward; the block or chip with most connections first; then every instance as one
   rigid block, side by side with the courtyard clearance between them, all instances of a sheet
   with the same arrangement and the same turn (the one with least wire). Each copy takes its
   block's inner copper. It answers `Placed 34 parts; …; 0 overlaps`, then `Notes: CH2 was moved as a
   block, keeping the arrangement of CH1; …; Copper: 32 pieces of copper went with CH1, …`. A block
   with no room on the board is put beside it, never on another block: without `fit` it is named
   in `Not placed: CH8 (no free room on the board for its … block; …)`, with `fit` the board grows
   round it.
5. Pours, then `autoroute` `{ file }` for the tracks between blocks and to the connectors.

An instance is one thing on the board: `set_props` `{ file, part: "CH3", props: { pcbX, pcbY,
pcbRotation } }` moves and turns it with its inner copper (`Copper: 4 pieces of copper went with
CH3`); copper that left it (to a connector or another block) is removed and shows as unrouted
again (`… removed (now unrouted)`). The Studio's moves and the placer's do the same.

On a board without sub-sheets, place block by block with `{ parts: [...] }`, the part with most
connections first, connectors last. The placer keeps decoupling capacitors beside their supply pins, a crystal beside the two chip pins
it is across with its load capacitors on its far side, and a pull-up or an LED's resistor beside
the pin it serves. After `autoplace`, read `board_summary`'s longest connections: a part far
from the pin it serves shows there with both pads' places. Move it with `set_props`
`{ pcbX, pcbY, pcbRotation }`; it then has a position, and `autoplace` leaves it alone.
Look at the board with `render` `{ file }` after `autoplace` and again after `autoroute`: it is the
Studio's own drawing, what the person sees; `parts: ["U1", "C3"]` zooms to those parts.
When the person wants to watch, or asks to open copperflow or the editor, `open_studio {}` starts the
Studio (or finds the running one), opens it in their browser and answers with the address and its
key: give that address to the person only.

Connectors are placed last, into the edge room the other parts left, so on a tight board a
connector can land far from the part it serves. If `board_summary` or `copper_summary` shows a
connector's nets much longer than the rest, note the unrouted count and those nets' lengths,
then `undo_change` the `autoroute` and the `autoplace` (`autoplace` moves only parts without a
position, so a second run over placed parts does nothing). Run `autoplace` with
`connectors: "ahead"` (each connector goes on the edge before the part it serves) and
`autoroute` again, and compare with what you noted. If it is not better, `undo_change` both and
place and route as before; a note in the answer says so when "ahead" was not kept and the
placement is the usual one. "ahead" is not the default because it can route worse.

`autoroute` answers `Change c0012: Routed 30 of 32 connections in 2 passes; unrouted: U1.pin3
(4.10, 2.00 top) to R1.pin2 (9.30, 2.00 top) (no room between U1 and C3), …`, then the copper
violations the change introduced. Each unrouted connection names its pads with their centres and
layer (`through` for a through pad); `check_circuit` with filter `copper` and `copper_summary`
list them the same way. When the router is boxed in by its own routes it takes them up, routes
the closed-in connection first and routes them again, keeping that only if fewer are left open.

Route by hand only what the router reports: `route_track` by reference,
`{ file, from: "U1.pin3", to: "R1.pin2" }`, runs the router's search for that one connection
(tracks and vias) or is refused naming what is in the way; with `via: [{ x, y }, …]` it draws
one track from pad centre through those corners to pad centre, on the pads' layer (or `layer`).
`route_track` with `net`, `layer` and `points` draws a track by coordinates (starting on a pad,
track or via of that net). `add_via` and `remove_copper` add and remove, and round track corners with
`fillet_tracks` (`straighten_tracks` squares them again); each is one history entry, and the
answer lists the copper violations the change introduced. Or move parts and run `autoroute`
again; `unroute` (`nets` or `all: true`) takes back the router's copper and never hand-drawn
copper, locked copper or router tracks that start on a locked part's pad (the answer names those).
After a circuit's nets are rewritten, the router's tracks for the old nets can join pads of two new
nets: `check_circuit` reports a `short` and, when only the router's copper makes it, a second line
`The router made t0012, t0013: unroute { file, nets: ["A", "C"] } removes them, then autoroute`.
`unroute` with either net takes back the copper of a short on it.

Details of the copper tools:
- `layer` is `top` or `bottom`; `inner1` and `inner2` exist only on a 4-layer board and cannot be
  routed in the Studio. With `from` and `to`, the layer defaults to the pads' shared layer; a
  `from` or `to` may name a pin by name (`"U2.GND"`). `width` defaults to the net class's width,
  else the fabrication default. No corner or segment may touch another net's copper.
- `add_via` takes its net from the pad or track under it unless `net` is given; its size follows
  the net class and the fabrication minimum ring; `layers` defaults to `["top", "bottom"]`. A via
  whose copper would lie on another via's is refused, naming that via.
- `remove_copper` takes a list, `{ ids: ["t0003", "v0002"] }`: whole tracks and vias by id. An
  entry `{ id: "t0003", segment: 1 }` in that list removes one segment instead (0 is from the
  first point to the second): the run before it stays as the track and the run after it becomes
  a new track; a run of one point disappears.
- `fillet_tracks` rounds with chords on an arc tangent to both legs, of the design rules' fillet
  radius (1 mm unless `rules.yaml` sets `fabrication.filletRadius`; a track's width is the floor).
  A corner stays square when its arc would break clearance, its legs are too short or its net's
  copper joins the replaced part; `straighten_tracks` keeps a corner round when the square corner
  would break clearance. Both leave locked tracks and tracks starting on a locked part alone; with
  no `tracks` they take every track of the board.
- `autoroute`'s `instance` route is copied to the other instances of its sheet placed the same
  way. When `budgetSeconds` runs out, what is routed is written and the rest is reported.
- `fit_board` and `autoplace` `fit: true` leave a 2 mm margin round the parts' courtyards by
  default; fitting refuses a board drawn with a non-rectangular outline.
- `fit_board` `{ file, width, height, x?, y? }` sets that rectangle, centred on (x, y) (default the
  board's own centre): `Change c0011: board 40 × 30 mm at (0, 0)`. `outline: [{ x, y }, …]` sets a
  polygon instead (its holes and keepouts stay). `layers: 2 | 4` sets the copper layers, alone or with
  a size; a 4-layer board also wants the `jlcpcb-4layer` profile (`set_rules`, design-rules.md).
  After a resize the answer names the placed parts now outside the board:
  `2 placed parts are now outside the board: J1, J2; move them inside or make the board larger`.
- `render` `{ file, out: "pics/top.png" }` also writes the picture into the project (a name not
  ending in `.png` and a path outside the project are refused); the answer adds `Wrote pics/top.png`.

`copper_summary` shows per net the tracks, vias, length and unrouted connections, each pour
(`copperpour:1 GND top: 812.40 mm², joins 14 pads`) and each hole (`hole:1 at (3, 3), 3.2 mm`),
then the copper violations counted by rule; at most 60 lines.

A locked part guards only the tracks that start on its pads; vias on it and tracks that only
end there are not locked, so leave them alone unless the human asks.

## Pours

Pours: before `autoroute`, a two-layer board gets a GND pour on both layers (`top` and `bottom`),
checked with `copper_summary`'s 'joins N pads': a pour joins
only the pads on its own layer and through pads, so a bottom pour under parts on top joins almost
nothing. `add_pour` `{ net: "GND", layer: "top" }` without an `outline` fills the whole board,
with thermal spokes to the GND pads, and the connections the fill makes count as routed. Tracks
of other nets cut the fill, so a pad the unrouted fill joined can end up cut off from it: the
router then routes that pad again, and with only one pour it may find no room. A second pour on
the other layer gives such a pad a way out through a via. It
answers `Change c0010: added copperpour:1 (GND, top)` and the fill line. Then `autoroute`, then
`check_circuit` (`pour-floating` warns of a pour that joins no pad of its net, `pour-sparse` of
one joining fewer than half of them, `pour-empty` of one left with no copper, `copper-hole` of
copper too near a hole).

`props` takes `priority` (higher wins where pours overlap; default 0), `clearance` (mm to other
nets; default the net class's), `minWidth` (narrowest copper kept; default 0.25 mm), `thermal`
(`relief`, the default, four spokes per pad, or `solid`), `thermalWidth` (spoke width; default
0.3 mm) and `thermalGap` (pad-to-pour gap; default 0.25 mm). `new_circuit` gives a board a GND
pour on the layer the parts sit on (both layers when a two-layer board is routed on both).

## Holes and ids

`remove_pour`, `add_hole` and `remove_hole` (mounting holes) work by id (`copperpour:1`,
`hole:1`), as do `edit_circuit`'s `add_pour`, `remove_pour`, `add_hole` and `remove_hole`;
`new_circuit` takes `pours` and `holes`. A part's lock never covers a pour; a pour or hole is
locked by its id, and a locked one is left alone. A pour or hole inside a sub-sheet instance
(`PS1/copperpour:1`) is written in its sheet file: edit that file instead.

## Designators

Each part's name goes on the silkscreen by itself at every build: beside a side of its courtyard,
running along that side (standing beside a left or right side, never upside down), clear of pads,
holes, vias, other parts, other names and the board's edge, and the same round every copy of a
sheet's part where that place is free. A name with no free place within 2 mm takes the least bad
one, and `check_circuit` gives a `silk-on-pad` warning naming what it covers. For such a name,
give the part room (move it or its neighbours), or put the name yourself with `set_props`:
`pcbNameAt` (`{ x, y }`, the name's middle as an offset from the part's origin, in mm, along the
board's x and y whatever the part's rotation) and `pcbNameRotation` (0 flat, 90 standing); the
other names go round it, and so do the board's `<silkscreentext>`s. `null` removes either. A name
is 1 mm tall, as the silkscreen prints it; `add_text`'s answer gives a text's ink box.
`pcbNameText: "IN+"` prints that text in place of the name, placed the same way, so a wire pad's
or a jack's label stays beside it when the part moves (better than a board `<silkscreentext>`,
which stays where it was written); `null` prints the name again. A label goes before the plain
names, never nearer another part's pad than its own, with a letter's room past either end so no
name reads on from it.
`pcbNameHidden: true` leaves a part's name off the silkscreen altogether; `null` prints it again.
