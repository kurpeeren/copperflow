# Copper: placing, routing, pours and holes

Read before you place or route a board, or draw copper by hand.

## Placing and routing

Copper: place the parts first with `autoplace` (one history entry; parts without a position, or
only some `parts` or an `instance`; `fit: true` also fits the board; it answers "Placed 12 parts;
wire length 184 mm (was 412); board 42 × 28 mm; 0 overlaps", then any part not placed), then run
`autoroute` (one history entry; it routes what is still unrouted, or only some `nets`, `parts` or
an `instance`, within `budgetSeconds`, 20 s by default, and names each connection it could not
route with the reason), then `check_circuit` once at the end (filter `copper` for the full list).

`autoroute` answers `Change c0012: Routed 30 of 32 connections in 2 passes; unrouted: U1.pin3 to
R1.pin2 (no room between U1 and C3), …`, then the copper violations the change introduced.

Route by hand only what the router reports: `route_track` (a track of one net, starting on a
pad, track or via of that net), `add_via` and `remove_copper`, and round track corners with
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

Pours: before `autoroute`, a board gets a GND pour on the layer the parts sit on (both layers when a
two-layer board is routed on both), checked with `copper_summary`'s 'joins N pads': a pour joins
only the pads on its own layer and through pads, so a bottom pour under parts on top joins almost
nothing. `add_pour` `{ net: "GND", layer: "top" }` without an `outline` fills the whole board,
with thermal spokes to the GND pads, and the connections the fill makes count as routed. It
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
