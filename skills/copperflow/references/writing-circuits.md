# Writing and reading circuits

Read before your first `new_circuit` or `edit_circuit` in a project.

## A part in new_circuit, place_part and add_part

- `part`: a library part id from `list_parts` (a chip made with `create_part` or `import_part`).
  Create the library part first; `new_circuit` refuses an id the library does not have.
- `kind`: a built-in part: `resistor`, `capacitor`, `inductor`, `led`, `diode`, `fuse`,
  `crystal`, `resonator`, `pinheader`, `pushbutton`, `switch`, `testpoint`, `transistor`,
  `mosfet`, `battery`, `potentiometer`, `chip` or `connector` (`place_part` takes the same names
  as `part`). Never `kind: "chip"` with hand-written pins: chips come from the library. A chip or
  connector needs `pinLabels`, `pinCount` or a footprint with known pads.
- `value`: the main value of a built-in part (`"10k"`, `"100nF"`).
- `footprint`: a generated footprint string for a built-in part (`"0402"`, `"0603"`); a
  library part brings its own.
- `props`: anything else, e.g. `{ pinCount: 4 }` for a pin header. A header's `pinLabels` is an
  object keyed `pin1`, `pin2`, … (`{ pin1: "V5", pin2: "GND" }`); an array is refused. Each name
  is letters, digits and `_` and does not start with a digit: `"5V"` is refused and the answer
  suggests `"V5"`. The same shape goes to `set_props`. `noConnect` (`"pin4,pin5"`) may be given here too.
- `name`: the designator, a letter then letters, digits or `_` (at most 32: `R1`, `U_MCU`). A
  library part id (`create_part`'s `id`) starts with a letter, ends with a letter or digit, and
  between has letters, digits, `.`, `_` or `-` (at most 64: `AP2112K-3.3`).

The built-in `led` and `diode` have `pin1` = `anode` and `pin2` = `cathode` (`D1.anode`,
`D1.cathode`); a resistor's or capacitor's pins are `pin1` and `pin2`.

A net names pins as `R1.pin1` or by a library pin name (`U1.VOUT`). A pin the part does not
have is refused before anything is written, and the answer lists the part's real pins: use one
of those. `new_circuit` refuses a file that exists; pass `replace: true` to overwrite it and its
sheet files (one history entry, so `undo_change` brings the old text back).

`new_circuit` places the schematic and routes its wires, then (unless `place: false`) places the
board as a second history entry, fitting the board round the parts when no `board` is given (the
default board is 30 x 20 mm). `undo_change` takes the placement back first, leaving the file as
written without positions; a second undo removes the files. `pages` lists the pages after the
first, `"Main"`, which holds every part not listed; an instance's name may be listed there too.
Pages are drawing only: a net name joins its pins on every page. In `sheets`, a net named like a
port is that port's and any other is local to each instance; each sheet is written as
`<name>.sheet.tsx` beside the circuit with local designators (R1, C1), and an instance's `sheet`
may also name a `<name>.sheet.tsx` already there. `base` 100 makes R1 into R101 (default 100, 200,
… in order). `make_sheet` does the opposite on a written circuit: the parts it moves get local
designator + base (100 or the next free one), and `rename` numbers them from 1.

In `edit_circuit`, `add_instance` is `{ sheet, name, connections, base?, page? }` (another use of a
sub-sheet, base default the next free hundred), `set_connections` `{ instance, connections }`
gives every port its net (ports left out are open), and `move_to_page` `{ part, page }` takes a
part or an instance (the page is made when missing). `set_props` sets `schNameAt` and `schValueAt`
(the part's name and value on the schematic, in sheet units) and `pcbNameAt` (its silkscreen
designator, in mm) as an offset `{ x, y }` from the part's origin that moves with the part; null
puts the label back. A null on `pcbX` and `pcbY` takes a part off the board, so `autoplace` places
it again; on `schX` and `schY` it goes back to the place the schematic gives it by itself. `noConnect: "pin3,pin10"` flags pins meant to stay open (no pin-unconnected
error, a cross on the schematic); null removes the flags.

## Reading what is there

`circuit_summary` shows parts the tools cannot edit as `[read-only: …]` with the reason (an
expression, a generated element); change those only by asking the human. Read the summary in
full before you edit a file. When the human says they changed something, call
`circuit_summary` again before you edit: your earlier reading is out of date.

## Positions the human set

Leave `schX`, `schY`, `pcbX`, `pcbY`, `pcbRotation` and `schematicRouteHints` of parts the
human placed as they are, unless the human asks for a new position. `autoplace` already leaves
them alone; do not undo that with `set_props`.

## Parts the human makes

The person can do what `create_part` does in the Studio: Library → New part… opens a form for
the part's pins and package and writes the same part.yaml. When a part needs a photo of the
datasheet or a choice only they can make, suggest that instead.

## Drawings, pages and corners

These `edit_circuit` keys write what the Studio's editor writes; each is one step of the batch, and
a wrong shape is answered with the right one. Sheet units on a schematic page, mm on the board.

- `add_drawing` `{ shape?, page?, name?, …props }`: `shape` is `"text"` (default: `text, x, y,
  fontSize?, anchor?` left/center/right), `"line"` (`points`), `"rect"` (`x, y, width, height,
  filled?`), `"circle"` (`x, y, radius, filled?`), `"arc"` (`x, y, radius, startAngle, endAngle`),
  `"junction"` (`x, y`) or `"bus"` (`name` such as `"D[0:7]"`, `points`). Lines take `strokeWidth`,
  `lineStyle` (solid, dashed, dotted) and `color` (`"#000080"`). Without a name it is `G<n>`, and
  the answer says which: `{ "add_drawing": { "text": "5 V in", "x": 2, "y": 1.5, "page": "Power" } }`.
  The common note is one `add_text` call: `{ file, text, x, y, page?, fontSize? }`.
- `set_drawing` `{ id, …props }` moves or changes one (`name` renames it); `remove_drawing` `{ id }`.
- `add_page` `{ name }`, `rename_page` `{ from, to }`, `remove_page` `{ name }` (refused while a part is on it; "Main" keeps its name).
- `wire_corners` `{ from, to, corners: [{ x, y }] }` sets the corners of the trace's schematic wire,
  to straighten one that crosses a label or symbol (`[]` removes them); `connect` takes `corners` too.
  The wire runs straight from the pin through each corner to the end, so a right angle needs a corner
  level with the pin: `render` the page afterwards and look.
  A net label, GND or power flag is such a wire to `net.NAME` with one corner: its symbol is drawn at
  the corner, picked from the net's name. Junction dots where wires meet are drawn by themselves;
  no-connect marks are `set_props` `noConnect: "pin3"`.
- `rename_parts` `{ "R7": "R1", "R1": "R7" }` (Annotate): every reference follows, copper keeps its
  nets. It goes alone in its call.
- In a `.sheet.tsx` file: `rename_port` `{ from, to }` and `sheet_size` `{ width?, height? }` (null:
  the ports decide). Instances in other files that name the old port must be updated with `set_connections`.
- `set_pour` `{ id, net?, layer?, outline?, priority?, clearance?, minWidth?, thermal?, thermalWidth?,
  thermalGap? }` (null removes a prop; outline null fills the board) and `set_hole` `{ id, x?, y?,
  diameter? }`, e.g. `{ "set_pour": { "id": "copperpour:1", "clearance": 0.4 } }`.

Text on the board's silkscreen (its name, a version, a connector's legend) is `<silkscreentext text="IO-8 v1"
x={0} y={9} layer="top" height={1.5} rotation={0} />` inside `<board>`, centred on x, y in mm; `layer="bottom"`
is mirrored so it reads from below. Write it with `add_text` `{ file, text, x, y, layer, height?, rotation? }`
or `add_drawing` with a `layer`; the answer names its id (`silkscreentext:1`) for `set_drawing` (`text`, `x`,
`y`, `layer`, `height`, `rotation`, `name`; null removes height, rotation or name) and `remove_drawing`, and
`board_summary` lists every one. Limits: one line, at most 100 characters, height 0.8 to 20 mm (default
1.5), and only the characters the lettering draws: A-Z a-z 0-9, space and `- _ + . / ~ ( ) # : % = , !`.
`check_circuit` reports text over a pad or hole (`silk-on-pad`) and text off the board (`silk-off-board`).

A drawing (a logo, a mark, a legend, a shape) from an SVG or DXF file is `<boardgraphic file="graphics/logo.svg"
layer="top-silkscreen" x={0} y={-6} width={10} rotation={0} fill={false} name="logo" />` inside `<board>`: the file
stays in the project's `graphics/` folder (only `graphics/<name>.svg|dxf` is read), centred on x, y in mm, `width`
in mm keeping its aspect (or `scale`; its own size when neither), turned `rotation` degrees. `layer` is
`top-silkscreen`, `bottom-silkscreen` (ink; the bottom is mirrored to read from below), `top-mask` or `bottom-mask`
(an opening in the solder mask: copper or bare board shows through), or a copper layer as pours name them (`top`,
`bottom`, `inner1`, `inner2`; inner ones on a 4-layer board only). On copper a drawing belongs to no net unless
`net="GND"` (any net of the circuit; refused off copper or for a net the circuit lacks, `drawing-net`). Of no net, the
router goes round it, pours keep clear of it, and `check_circuit` reports any copper closer than the clearance
(`copper-clearance`, "boardgraphic:1 touches the track t0007 of GND"). On a net it is that net's copper: it joins the
net's pads, tracks and vias it touches (their airwires go), the net's tracks may run onto it, a pour of the net merges
with it, other nets keep the clearance, touching another net is a `short`, and touching nothing of its net is an island
(`drawing-floating`). Either way the board edge (`copper-edge`), a `<hole>` (`copper-hole`), and lines or parts of a
filled shape thinner than the minimum track width (`drawing-width`, with a point in the thin part) are reported. A bare-copper logo is the same drawing on `top` and on `top-mask`. At most 5000 triangles on copper:
simplify a larger drawing. Write the SVG yourself with your file tools, then `import_graphic` `{ file, source, layer, x?, y?, width?,
scale?, rotation?, fill?, name?, net? }` (source elsewhere in the project is copied into `graphics/`; no x, y: the board's
centre); the answer names its id (`boardgraphic:1`), its size in mm and what the reader left out (text, images).
Dark shapes are ink and light shapes cut them out, in the file's order (a white letter over a black disc is a gap);
gradients and images are not read. SVG lines keep their `stroke-width`; a DXF has lines of no width (they print at 0.15 mm)
and fills only from SOLID or HATCH, so give `fill: true` to fill its closed outlines. Move, resize, re-layer or
remove it with `set_drawing` (`file`, `layer`, `x`, `y`, `width`, `scale`, `rotation`, `fill`, `name`, `net`; null removes `net`) and
`remove_drawing`; `board_summary` lists it. A bad or missing file is a build warning and the drawing is left out.
`check_circuit` reports silkscreen ink over a pad or hole (`silk-on-pad`), off the board (`silk-off-board`) and
lines thinner than a board house prints (`silk-too-thin`). The CLI is `copperflow graphic <file> <drawing> --layer …`.
`redo_change` `{ id? }` brings back a change you undid by mistake; it never redoes a human's undo.

## Export

`export_fabrication` `{ file, out? }` writes into the circuit's folder, or into the project
folder `out` (e.g. `"fab"`). Pass on every `Warning:` line: connections not routed, parts
without a footprint, silkscreen over pads, parts without an LCSC number (JLCPCB assembly will
not match them). A design with errors is refused and nothing is written. It writes Gerbers,
plated and non-plated drills, pick-and-place and the BOM into `<name>-fab/` and
`<name>-fab.zip`. `bom` and `export_package` read the built design, so parts made in loops count.
`bom` ends with the order report (ready for bare boards, ready for assembly, each line without a
supplier part number and how to add one) and `export_fabrication` with its two verdicts;
`export_package` also writes `pins.md` and a `<part>_pins.h` per library chip, the pin map for the firmware.

`export_model` `{ file, format, out?, look? }` writes one 3D model file beside the circuit, for a
design that still has errors too: `format: "step"` is the STEP file for mechanical CAD (the board
and each part as a box), `format: "glb"` a GLB file a 3D viewer turns (the board as made, in the
`look` asked for, and the parts as simple shapes, not their real models). Its answer names the parts
whose height is typical or assumed; pass that on when the person will fit an enclosure around it.

`export_html` `{ file, out?, look? }` writes `<name>.html`: the whole design as one web page (every
schematic page, the board, 3D, the BOM, and the fabrication zip, GLB, STEP and BOM CSV inside as
downloads). Use it to hand the design to a person as one file; it opens offline.

Export only a clean board: `check_circuit` with 0 errors and no `unrouted` warning. With
connections still unrouted the files are written with a warning, but the board is not finished
and must not be ordered: say so, then route them with `route_track` by reference
(`{ from: "C3.pin2", to: "U2.pin2" }`), or move the part in the way and run `autoroute` again.

A part not placed yet (no `pcbX`/`pcbY`) gets only the `unplaced` warning; its board-edge,
courtyard and clearance findings wait until it has a position.
