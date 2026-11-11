# Writing and reading circuits

Read before your first `new_circuit` or `edit_circuit` in a project.

## A part in new_circuit, place_part and add_part

- `part`: a library part id from `list_parts` (a chip made with `create_part` or `import_part`).
  Create the library part first; `new_circuit` refuses an id the library does not have.
- `kind`: a built-in part (`resistor`, `capacitor`, `inductor`, `led`, `diode`, `pinheader`,
  …). Never `kind: "chip"` with hand-written pins: chips come from the library.
- `value`: the main value of a built-in part (`"10k"`, `"100nF"`).
- `footprint`: a generated footprint string for a built-in part (`"0402"`, `"0603"`); a
  library part brings its own.
- `props`: anything else, e.g. `{ pinCount: 4 }` for a pin header.

A net names pins as `R1.pin1` or by a library pin name (`U1.VOUT`). A pin the part does not
have is refused before anything is written, and the answer lists the part's real pins: use one
of those. `new_circuit` refuses a file that exists; pass `replace: true` to overwrite it and its
sheet files (one history entry, so `undo_change` brings the old text back).

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
not match them). A design with errors is refused and nothing is written.
