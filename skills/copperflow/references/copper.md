# Copper: placing, routing, pours and holes

Read before you place or route a board, or draw copper by hand.

## Placing and routing

Copper: place the parts first with `autoplace` (one history entry; parts without a position, or
only some `parts` or an `instance`; `fit: true` also fits the board; it answers "Placed 12 parts;
wire length 184 mm (was 412); board 42 × 28 mm; 0 overlaps", then any part not placed), then run
`autoroute` (one history entry; it routes what is still unrouted, or only some `nets`, `parts` or
an `instance`, within `budgetSeconds`, 20 s by default, and names each connection it could not
route with the reason), then `check_circuit` once at the end (filter `copper` for the full list).

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
copper.

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

`props` takes `priority`, `clearance`, `minWidth`, `thermal` (`relief` or `solid`),
`thermalWidth` and `thermalGap`.

## Holes and ids

`remove_pour`, `add_hole` and `remove_hole` (mounting holes) work by id (`copperpour:1`,
`hole:1`), as do `edit_circuit`'s `add_pour`, `remove_pour`, `add_hole` and `remove_hole`;
`new_circuit` takes `pours` and `holes`. A part's lock never covers a pour; a pour or hole is
locked by its id, and a locked one is left alone. A pour or hole inside a sub-sheet instance
(`PS1/copperpour:1`) is written in its sheet file: edit that file instead.
