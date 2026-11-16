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
puts the label back. `noConnect: "pin3,pin10"` flags pins meant to stay open (no pin-unconnected
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

## Export

`export_fabrication` `{ file, out? }` writes into the circuit's folder, or into the project
folder `out` (e.g. `"fab"`). Pass on every `Warning:` line: connections not routed, parts
without a footprint, silkscreen over pads, parts without an LCSC number (JLCPCB assembly will
not match them). A design with errors is refused and nothing is written. It writes Gerbers,
plated and non-plated drills, pick-and-place and the BOM into `<name>-fab/` and
`<name>-fab.zip`. `bom` and `export_package` read the built design, so parts made in loops count.

Export only a clean board: `check_circuit` with 0 errors and no `unrouted` warning. With
connections still unrouted the files are written with a warning, but the board is not finished
and must not be ordered: say so, then route them with `route_track` by reference
(`{ from: "C3.pin2", to: "U2.pin2" }`), or move the part in the way and run `autoroute` again.

A part not placed yet (no `pcbX`/`pcbY`) gets only the `unplaced` warning; its board-edge,
courtyard and clearance findings wait until it has a position.
