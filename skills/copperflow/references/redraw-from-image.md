# Redrawing a board from a scan or a photo

Read before you redraw a board that exists from a picture of it: a scan or photo of either side,
with or without its parts. The result is a circuit file with the parts where the original has
them, the nets read from its copper, and a list in PROJECT.md of what could not be read.
A KiCad file or a `.dxf` of the board is faster than any picture: `fit_board` `{ file, drawing }` (copper.md).
(Without this skill installed, `guide { "topic": "redraw-from-image" }` returns this page.)

Do the measuring in one small script (Python with Pillow, NumPy and SciPy, in your scratch
folder) that holds the picture-to-board transform, and use that same script at every step. Never
read pixel positions by eye from a picture shown smaller than its file.

## 0. Ask first, in one message

- **The pictures.** Best: both sides of the bare board (parts removed) on a flatbed scanner,
  600 dpi, colour, saved as PNG or TIFF, lid closed or a sheet of paper over the board. Every
  track and hole of both sides shows, at one scale, with no slant. Before the parts come off: a
  note or photo of each diode's band and each capacitor's `+` or `-`; the pads do not show them.
  With the parts on: a photo of each side straight from above, no flash, the whole board and all
  mounting holes in the frame; a photo with light behind the board shows the tracks. Ask for the
  files as files: a chat app that shrinks pictures loses the thin gaps between copper.
- **One measure.** The board's width and height, or the distance between two mounting holes,
  to check the scale.
- **What it does and what it carries**: the supply voltages, which terminal is which, the part
  numbers printed on the chips. Net names come from this; without it they are neutral (`N1`…).
- **Any files of it**: a Gerber, a KiCad or EasyEDA project, an older version's netlist.

## 1. Scale and align the picture

- **Scale.** A scan has one scale: mm = pixels × 25.4 / dpi. A scan inside a PDF has the dpi of
  its page: 1653 pixels across an A4 page 210 mm wide is 200 dpi. Check it against the person's
  measure. A scanner can crop a little of the board's edge; holes are the better reference.
- **Holes.** Find hole centres in the script: round pads or drill holes of the right size, as
  connected components (`scipy.ndimage.label`, then `center_of_mass`). Print them with numbers
  and look at a picture with the numbers drawn on, zoomed in tiles.
- **Board coordinates.** The board is centred on the origin, x right, y up (top is the largest
  y); an image has y down. A picture of the bottom side is a mirror image: flip one axis (x
  when the board was turned over left to right). A scan needs
  a scale, a turn and a shift; a photo needs four or more points for its slant (a perspective
  fit, `numpy.linalg.svd` on the point pairs).
- **Both sides.** Fit the back to the front by the holes they share: try the eight right-angle
  turns and mirrors, shift by the nearest-hole median, keep the one with the least error. A
  median under a pixel is a good fit. Holes seen on one side only are vias or a misreading.
- **The underlay.** Lay the picture under the board: `import_graphic` `{ file, layer: "reference", source: "scan-bottom.png" }`,
  then align it by holes, each point `[pixel x, pixel y, board x, board y]`:
  `{ file, layer: "reference", reference: { id: "r1", mirror: true, points: [[213, 297, -60.31, 50.02], …] } }`
  (copper.md). Use four or more points spread to the board's corners: three points on a phone
  photo taken at a slight angle miss by 2 to 3 mm. A JPEG's camera turn is applied, so pixels
  are those of the photo as shown. Every later `render` `{ file, reference: true }` draws it
  under the board.

## 2. Board outline and holes

The board's size and its mounting holes go in the same `new_circuit` call as the parts (step 4):
`board: { width: 129, height: 109 }`, `holes: [{ x: -60.31, y: -50.31, diameter: 3.2 }, …]`, in mm.
A shape that is not a rectangle: `fit_board` `{ file, outline: [{ x, y }, …] }`. A hole added
later: `edit_circuit` `{ file, edits: [{ add_hole: { x, y, diameter } }] }`. Mounting holes only: a part's own holes come with
its footprint.

## 3. Identify the parts and their footprints

List every part: its designator from the silkscreen, the marking on its body, its body size, its
holes or pads and their pitch measured between hole centres (2.54, 3.5, 5.08, 7.62 mm). Then
find a footprint, in this order:

1. A part already in `list_parts`, or in the person's other projects (copy its folder from
   that project's `parts/` into this one).
2. A footprint string: `guide` `{ topic: "packages axial" }` lists them (`axial9.5x14_d5.3`,
   `radial8x3.5`, `pinrow9_p7.62mm`, `soic8`).
3. `create_part` from the datasheet of the marking (parts-library.md), its pads checked against
   the holes you measured.

Pin 1 is usually the square pad. Polarity comes from the silkscreen band or `+`, or from the
person's notes; a part whose value or polarity you could not read is a question, not a guess.

## 4. Place each part at its measured position

`list_parts` `{ id }` lists each pad's place from the part's origin (pin 1 of a terminal block
is not at its origin). From the board positions of two of a part's holes, its `pcbX`, `pcbY`
and `pcbRotation` (degrees, counter-clockwise) follow; compute them in the script. Write all
parts in one call:
`new_circuit` `{ file, board, holes, parts: [{ name: "K1", part: "HLS-14F2L-DC24V-C", props: { pcbX: -51.25, pcbY: -5.1, pcbRotation: 0 } }, { name: "D1", kind: "diode", footprint: "axial9.5x14_d5.3", props: { … } }], place: false }`.
`place: false` keeps your positions; a redrawn board needs no `autoplace`. A part moved later:
`edit_circuit` `{ file, edits: [{ set_props: { part, props: { pcbX, pcbY, pcbRotation } } }] }`.

Check every pad, not the look: in the script, put each pad of the circuit (from `list_parts` `{ id }`,
turned and moved) on the picture and find its nearest hole. Each part should sit within about
0.3 mm; one off by a whole pitch (a terminal block shifted one pin) is the usual miss. Draw the
pin names on the picture and look at it zoomed in. A part soldered on the bottom side takes
`layer: "bottom"` in its props; its pads' x offsets are then mirrored.

## 5. Nets from the visible copper

On a bare-board scan, copper and the gaps between copper differ in colour (bright and dark red
on red copper; tinned pads are grey). Measure the threshold from one colour channel's
histogram, then in the script, per side:

1. Mark copper, gaps and pads; take a hole or silkscreen pixel as whatever lies nearest it.
2. Label the connected copper regions (`scipy.ndimage.label`).
3. Each pin is on the region under its pad; join a front region and a back region at every
   plated hole (the circuit's pads and the vias) by union-find. Each joined group is a net.

The reading moves with the threshold: thicken the gaps by one and two pixels and compare. Keep
the connections that read the same every time; zoom on the rest and decide by eye, or ask. Text
printed over a gap hides it: treat the copper under silkscreen as unknown. On a photo of a board
with its parts on, a dark line is sometimes a thin track and sometimes the edge of a wide copper
area: take only the connections that read the same either way, and ask for a scan for the rest.

Write the nets in one change: `add_trace` `{ file, nets: { V24: ["J1.pin8", "C1.pin1", "D1.cathode"], N5: [...] } }`
(or `nets` in the first `new_circuit`). A net's name comes from the silkscreen, a terminal's
label or the person; otherwise `N1`… and a `note_decision` saying how it was read. A net list
you already have (an older version, a guess from the person) is compared, not trusted: report
each net that is the same, split or joined.

## 6. Tracks

Ask which the person wants. A board to be made again with the same parts and nets: add the
pours, then `autoroute` (steps 10–11 of the skill); wider tracks for the currents the original
carried go first in `set_rules` (design-rules.md). A copy of the original copper: per track,
`route_track` `{ file, net, layer: "bottom", points: [{ x, y }, …], width }` along its centre
line, with the width measured from the scan; `route_track` `{ file, at: { x, y } }` for a via where it changes side; a copper area is an
`edit_circuit` `add_pour` step `{ net, layer, outline: [{ x, y }, …] }`.

## 7. Check against the picture

- `check_circuit` `{ file }`; `pin-unconnected` names each pin no net reached: right for an
  unused relay contact, a question for anything else.
- `render` `{ file, view: "board", side: "bottom", out: "pics/bottom.png" }` draws the bare
  board from below, as a scan of the bottom shows it; `render` `{ file }` the top with its parts;
  with the underlay, `render` `{ file, reference: true }` puts it under the board. Compare part
  by part: places, turns, the pad of pin 1, polarity marks.
- `circuit_summary` `{ file, view: "board" }`: each part's place and turn, against your list.
- Send the person the scan with every pin's name drawn on it: it is the quickest way for them to
  check your reading.

## 8. What to tell and ask the person

- Each connection that changed with the threshold or lay under silkscreen, as a pair of pins to
  check with a meter's continuity beep.
- Each value, polarity or part number you could not read.
- What was assumed: `note_decision` `{ text }` for each choice as you make it, and
  `note_decision` `{ text, open: true }` for each thing left to check, so the next session
  continues from it.
