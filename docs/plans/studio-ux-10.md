# Studio UX round 10: rounded tracks and labels that move

Asked by the maintainer (2026-11-10), while routing by hand on the demo board:

- "Convert tracks to splines with one key, as KiCad does" — KiCad's Fillet Tracks (Edit → Fillet Tracks, a radius, every selected corner becomes an arc). EasyEDA Pro has Arc routing and a corner "Round" option.
- "We must be able to move component names on the schematic too" — EasyEDA and KiCad let the designator and the value be dragged away from the symbol; today both sit where the engine puts them.

A third request, sheets and reusable sub-sheets, is an engine feature and has its own plan (`docs/plans/engine-stage-6.md`).

## Global constraints

The round 1–9 constraints hold (English; one-line commits without trailers; no new dependencies; no EasyEDA artwork; small tested modules; typecheck, test and build pass; nothing a person placed is moved by the engine). Every new edit is one history entry, goes through `src/core`, and respects locks. Pure geometry lives in modules the tests can run without a DOM.

## Decisions

- **Arcs are stored as points.** A rounded corner is written into the track record as a run of short chords on the arc (angular step at most 15°, and at most the step that keeps the chord within 0.005 mm of the arc), so the layout file, the nets, the ratsnest, the DRC, the hit tests and the segment drag need no new shape. A real arc record is not introduced in this round; the chord run is marked by nothing but its geometry, and **Straighten** recovers the corner by extending the two straight runs that frame it to their meeting point.
- **A fillet never cuts a corner it may not.** The fillet moves copper to the inside of the bend. A corner whose arc would come closer than the clearance to another net's copper, a pad, a keepout or the board edge, or whose two legs are shorter than the radius needs, is left square and counted in the summary ("Rounded 14 corners on 6 tracks; 2 left square: too short, too close to GND").
- **The radius is a design rule.** `Fillet radius` in the Design rules panel (and `rules.yaml` under `fabrication`), default 1 mm; a track's own width is the floor (a radius under the width is raised to it). KiCad asks for the radius each time; we do not, the panel holds it.
- **Label positions are props.** A moved designator or value is written as an offset from the symbol's origin, in sheet units, through `set_props`: `schNameAt={{ x, y }}` and `schValueAt={{ x, y }}` for the schematic, `pcbNameAt` for the silkscreen designator. The engine draws the label there and never moves it again; without the prop today's placement stands. A model can set them too.

## Task 1: fillet and straighten

- `studio/src/pcb/fillet.ts` (pure): `filletTrack(points, radius, width)` returns the new points and the corners it could not round, each with a reason; `straightenTrack(points)` finds the chord runs (consecutive short segments turning the same way at near-equal angles) and replaces each by the meeting point of its framing runs. Both idempotent on their own output. Fillet then straighten gives the original points back within 0.001 mm.
- The clearance test for a rounded corner uses the stage 4 DRC helpers on the proposed chords (track–track, track–pad, via–track, keepout, board edge) against everything but the track itself.
- Edit → **Fillet tracks** and Edit → **Straighten tracks** on the PCB (and in the track's context menu): act on the selected tracks, or on every track of the board when nothing is selected (a confirm names the count); one history entry of `setTrack` edits; the summary as above; a shortcut shown in Help → Keys (pick one that no listed key uses).
- Design rules panel: the `Fillet radius` field with the default and the floor rule; `rules.yaml` round trip.
- MCP: `fillet_tracks { file, ids?, radius? }` and `straighten_tracks { file, ids? }`, compact answers, same rules.
- Tests: the chord step bound; a 90° and a 45° corner at several radii; corners too short or too close left square with the reason; straighten recovers fillet; idempotence; the edits and the summary; the MCP tool shapes.

## Task 2: labels that move

- Engine: `schNameAt`, `schValueAt`, `pcbNameAt` props on parts (validated as a point), used by `src/engine/schematic.ts` and `pcb.ts` for the label anchor; the defaults are today's placement; the label's bounds stay in the layout so the Studio can pick them.
- Studio schematic: the designator and the value are picked after wires and parts (Filter tab: "Names and values" row), highlighted on hover, dragged with live drawing and snapped to the grid, dropped as one `set_props` edit; the arrow keys move a selected label; Properties shows the offset with a "Reset position" button; Delete does nothing to a label (hiding is a separate matter, not this round). Moving the part moves its labels with it (the offset is relative).
- Studio PCB: the same for the silkscreen designator.
- Tests: the engine anchor from the prop; pick order; the drag edit; reset; a moved part keeps its labels' offsets.

## Task 3: one segment of a track

Asked by the maintainer (2026-11-10): "double-click a track and delete only the segment where it was clicked, then draw it again". KiCad deletes a single segment by default; EasyEDA Pro selects a segment on click and the whole track on double click. Ours today picks the whole track.

- A **double click** on a track selects the segment under the pointer alone (selection value: track id + segment index), outlined in white; a single click still selects the whole track. Properties shows the segment's length, its two ends and the track's net.
- **Delete** on a segment removes it: the track record is split into the two remaining runs (each keeps the net, layer and width; a run with one point disappears), as one history entry through the core (`setTrack` + `addTrack`, or `removeTrack` when nothing is left); the context menu gets "Delete segment". The open ends are then floating (the engine reports them as today) and the track tool starts on either of them to draw the piece again.
- Dragging a selected segment behaves as the whole-track segment drag does today.
- MCP: `remove_copper` accepts `{ id, segment }` for the same split.
- Tests: the split edits for a first, a middle and a last segment; a two-point track; the selection value and the pick on double click; the menu item; the MCP shape.

## Task 4: a dark theme

Asked by the maintainer (2026-11-10): "the schematic should also have a dark theme, and it should feel like Flux.ai" — a dark charcoal workspace, a quiet dot grid, bright wires and a glowing selection. Round 9 left dark mode out; this task adds it as our own, with the copper identity kept. No Flux artwork, names or colour values are copied; the feel is the target, the values are ours.

- **Switch.** View → Theme → Light / Dark (a checked pair; the choice is remembered per browser; default Light). The whole Studio changes, chrome and canvases, with no reload.
- **Chrome tokens** (theme.css, under `:root[data-theme="dark"]`): app background `#16181D`, panels `#1D2026`, strips `#191C21`, hairlines `#2A2E36` (hover `#3A4049`), text `#E6E8EB`, muted `#9AA1A9`, disabled `#5C636B`, copper `#D98A3F` (hover `#E89A4F`, wash `rgba(217,138,63,.16)`, text on copper `#1A1206`), menu shadow `0 6px 20px rgba(0,0,0,.45)`. Every chrome colour already goes through a token (round 9), so no rule outside theme.css changes colour; a test greps for raw hex as today.
- **Schematic canvas, dark palette** (a second `schematicTheme`, chosen by the theme): background `#141619`; the grid as dots `#2B3038` (dot grid in dark, lines in light), the fifth dot `#3A4049`; symbol bodies and pins `#D9DEE5`; wires `#5BD3C7`; buses `#8AB4FF`; junctions in the wire colour; net labels `#F2C66D`; power and ground flags `#FF9E80`; designators `#E6E8EB`, values `#AEB6C0`, pin names `#AEB6C0`, pin numbers `#7E8792`; drawings `#9AA1A9`; selection `#4CC9F0` with a soft glow (`shadowBlur` 8 device px in the selection colour, nothing else glows); hover outline `#8BE0F5`; violation markers keep their red and amber (`#FF6B6B`, `#FFC857`); auto-placed dots and the sheet frame in muted. Text contrast against the background is at least 4.5:1 for designators, values and labels (a test computes it, as round 9's contrast test does for the chrome).
- **PCB canvas** stays as it is (already dark); its paper margin and the ruler take the chrome tokens so the frame matches.
- **Crispness.** Hairlines stay one device pixel in both themes; the dot grid is drawn with device-pixel-aligned rects, fading as the line grid does (round 9 thresholds).
- Tests: the token values and the switch state; the dark `schematicTheme` values; the contrast bound; the grid style per theme; the View menu items; no raw hex outside the allowed files.

## Task 5: browser check (controller)

On the check copy: round a hand-drawn two-corner track, see chords on the arc and the summary; straighten it back; a corner near another net's pad stays square and is named; drag R1's designator on the schematic, see the prop in the file and the label follow the part when it moves; double-click a track's middle segment, delete it, see two tracks and the ratsnest line return, and draw the piece again from one open end.
