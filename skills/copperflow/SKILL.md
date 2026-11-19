---
name: copperflow
description: Work on copperflow circuit projects, where *.circuit.tsx files are edited by a human and an agent together. Use when designing a board, placing, moving, connecting or removing parts in a *.circuit.tsx file, or when the user mentions copperflow, PROJECT.md, locked parts, marks or undoing a change.
---

# Working in a copperflow project

A human edits the same circuit files you do. They lock parts they have placed, leave marks
with instructions, and undo changes they do not want. Your job is to make progress without
undoing their work. Every tool answers in a few lines that say what it did; read the answers,
not the files.

## Every task

1. `project_status` `{}` first. It
   answers with PROJECT.md (`Intent: …`, `Blocks:`, the last five `Decisions:`, `Open:`), then one
   line per circuit (`main.circuit.tsx: parts 12, nets 9, unplaced 0, unrouted 3, errors 0,
   warnings 2`) and its last three changes. `No PROJECT.md yet` with `Circuits: none yet` is a new project: start
   the design workflow. `No PROJECT.md yet` with `Circuits (n):` is a board begun without one:
   read `circuit_summary` of each circuit, write the Intent and Blocks from what exists with
   `set_project` (each block's status as far as it got), and continue from there; never start over.
2. For the file in hand, `circuit_summary` `{ file }`: one line per part and per net, then
   `Locked:`, the marks (`Mark <id> (pcb x, y): …`) and `Lock violations:`. Use
   `detail: "full"` only when you need every prop; `filter: "J2"` shows one part (its props and
   nets), `filter: "PS1"` one instance. Read it again whenever the human says they changed something.
3. `recent_changes` `{ limit? }`: newest first; a change marked `[undone]` was rejected by the
   human: do not make it again unless they ask. `list_circuits` lists the circuit files.
4. Do the work (below), then `check_circuit` once at the end, then tell the human what you
   changed and the change ids (`c0012`), so they can undo a single step.

## Resuming

On a board already under way, continue from the first step that is not done, read off
`project_status`: a block with status `planned` → design it (steps 2–5); `errors N` above 0 →
`check_circuit` and fix them; no approval in `Decisions:` → ask (step 6); `unplaced N` above 0 →
`autoplace` (step 7); `unrouted N` above 0 → pours and `autoroute` (steps 10–11); all zero →
check and export (steps 12–13). An `Open:` item the human wrote comes first.

## The design workflow

For a new board, or a new block on one, work in this order. Each step names the tool and the
first line of its answer. The worked example is in
[references/design-workflow.md](references/design-workflow.md); what a part in `new_circuit`
means, `replace`, refused pins and the export's warnings are in
[references/writing-circuits.md](references/writing-circuits.md).

1. **Plan.** A new board starts with [references/planning.md](references/planning.md): every
   question in one message, a search for sources, blocks with ports, a sub-agent each. Then `set_project`
   `{ intent, blocks: [{ name, does, status }], open }` writes PROJECT.md:
   `Change c0001: Intent, Blocks, Open written to PROJECT.md`. `intent` is a string of at most
   2000 characters, `blocks` an array of at most 50 objects, `open` an array of at most 50
   non-empty strings (`["route the board"]`, not one string). Update a block's status the same
   way as it moves on (`designed`, `placed`, `routed`).
2. **Choose parts before writing the netlist**: `new_circuit` with `part:` needs the library part
   to exist. In this order: a part already in `list_parts` (one line each,
   `id <chip> title footprint verified|NOT verified`; `part_info` `{ id }` shows its part.yaml);
   a built-in part with a generated footprint string (`kind: "resistor"`, `footprint: "0402"`);
   for a chip, `create_part` from the datasheet with a generated package string such as
   `package: "soic8"` (`Created <id>: <title>, N pins, footprint …`, `It is NOT verified: …`).
   No datasheet you can read: tell the person, write `Pins NOT from a datasheet` in the part's
   `description`, and ask for the datasheet rather than writing pins from memory;
   `import_part` `{ lcsc }` only when the human asks for an LCSC number (`Imported C7950 as
   <id>: …`). An import is for personal, non-commercial use only and is always unverified. The
   person can make a part themselves in the Studio with Library → New part…. See
   [references/parts-library.md](references/parts-library.md); `part_info` lists each pad, `set_part_fields` `{ id, suppliers: { lcsc: "C6186" } }` sets a supplier number or MPN. `bom` `{ file }` lists what the
   board uses. Built-in kinds taking `value`: `resistor` (resistance, `"10k"`), `capacitor`
   (capacitance, `"100nF"`; `props: { polarized: true }`), `inductor`, `crystal` (frequency,
   `"8MHz"`), `resonator` (frequency), `fuse`, `battery`, `potentiometer`. `led` and `diode` take no value (`led`:
   `props: { color: "green" }`; pins `anode` = pin1, `cathode` = pin2); `pinheader` takes `props: { pinCount, pitch: "2.54mm", pinLabels }`,
   `pinLabels` an object keyed `pin1`… (`{ pin1: "V5", pin2: "GND" }`, not an array; so in `set_props`;
   names are letters, digits and `_`, not starting with a digit: `V5`, not `5V`). Designators and part
   ids: [references/writing-circuits.md](references/writing-circuits.md);
   `chip` comes from the library (`part:`). Footprint strings: `soic<N>` (3.9 mm), `soic<N>w`
   (7.5 mm: 16–28), `sop<N>`, `ssop<N>`, `tssop<N>`, `qfn…`, `qfp…`, `sot23_5`; the full list is
   in [references/editable-subset.md](references/editable-subset.md). A connector with no family
   (a screw terminal) is a `pinheader` with its pitch (`pinrow2_p5.08mm`), noted in PROJECT.md's
   Open for the person to replace.
   Unused inputs of a chip: tie them off as the datasheet says and `note_decision` it, or flag
   them with `set_props` `{ part: "U1", props: { noConnect: "pin4,pin5" } }` (null removes), or
   give `noConnect` in the part's `props` in `new_circuit`.
3. **Blocks first.** Every block of the plan is a sub-sheet with ports, also a block used once;
   only a small board (about fifteen parts, nothing repeated) is written flat, its blocks named in
   PROJECT.md's Blocks and later placed together with `autoplace { parts: [...] }`.
   `new_circuit` `{ file, parts, nets, sheets, instances, place: false }` writes the circuit and
   each `<name>.sheet.tsx`: `Change c0002: wrote main.circuit.tsx, Channel.sheet.tsx`, then the
   counts, one line per instance (`CH1 Channel base 100: IN=AIN1 GND=GND`), `N nets, M traces`
   and `Now call check_circuit once.` A repeated block (the same regulator or channel used twice
   or more) goes in a sheet once, not as parts written twice: `sheets: { Channel: { parts, nets,
   ports } }`, `instances: [{ sheet: "Channel", name: "CH1", connections: { IN: "AIN1" } }]`.
   Inside a sheet the designators are local (R1); each instance adds its base (R101, R201).
   Parts already written move into a sheet with `make_sheet` `{ file, name, parts }`
   (`Change …: wrote X.sheet.tsx; X1 X base 100 replaces 3 parts`, its `Ports:` and
   `Designators:`). For a large schematic use pages (`pages` in `new_circuit`, `page` in
   `place_part`, `move_to_page` in `edit_circuit`); nets join across pages by name.
4. **Design each block.** Write parts and connections, not positions or wire corners: the
   program places and routes. `edit_circuit` `{ file, edits: [...] }` applies a list as one
   change (`Change c0004 applied: 3 edits: …`; nothing written if one is refused, and the answer
   says which). `connect_nets` `{ file, nets: { GND: ["R1.pin2", "C1.pin2"] } }` answers
   `connected 4 pins (GND +4)`. Single edits: `place_part`, `set_props`, `remove_part`,
   `add_trace`, `remove_trace`. These tools enforce locks and record history; editing the file
   directly does not. Labels move with `set_props` `schNameAt`, `schValueAt`, `pcbNameAt`
   (a point `{ x, y }` from the part's origin; `null` puts it back).
5. **Clone channels as instances.** Another use of a block is `edit_circuit`'s `add_instance`
   `{ sheet, name, connections }`; `set_connections` rewires one. Never copy its parts.
6. **Ask the person before the PCB.** Stop here. Run `check_circuit` and fix its errors, then
   summarise the blocks and the parts chosen (and which are unverified) and ask whether to go on
   to the board. Wait for a yes; `note_decision` what they approved.
7. **Place.** A small board (a dozen or two parts, no sheets): one `autoplace` `{ file }`. With
   sheets, blocks first: `autoplace` `{ file, instance: "CH1" }` packs one sheet's first instance
   on its own, `autoroute` `{ file, instance: "CH1" }` routes its inside (`Routed 4 of 4 connections`;
   a `short` with copies still sitting on it lasts until the board is placed), `render` to look.
   Then the board, `autoplace` `{ file, fit: true }`: connectors on the edges, the block with most
   connections first, every instance whole, side by side, turned alike, with its block's copper
   (`CH2 was moved as a block, keeping the arrangement of CH1`, `Copper: 32 pieces of copper went
   with …`); then pours and `autoroute` for the tracks between blocks. One change: `Placed 34 parts;
   wire length 233 mm (was 197); board 32 × 24 mm; 0 overlaps`, `Change c0007; …`, `Not placed:`, `Notes:`.
   Parts placed or locked by a person stay. `set_props` `{ pcbX, pcbY, pcbRotation }` on an instance's
   name moves it with its copper; copper leaving it is removed (unrouted again).
   `Not placed: U1 (no free spot …)`: `fit: true` grows the board for it in the same call, or `set_props` `{ pcbX, pcbY }`. `Copper left behind: t0012 …` (copper does not follow a part): `remove_copper` those ids or `unroute`, then `autoroute`.
   `board_summary`'s longest connections show a part far from the pin it serves; move it with
   `set_props`. Do not repeat `autoplace` hoping for better. Details: [references/copper.md](references/copper.md).
8. **Board shape.** `fit_board` `{ file, margin? }`: `Change c0010: board 42 × 28 mm (margin 2 mm)`; an exact size is `{ file, width, height }`, a shape `{ file, outline }`, copper layers `{ file, layers: 4 }` (copper.md); holes: `add_hole`. A `.dxf` in the project: step 7 starts with `import_board`, then `render` (copper.md). A logo or mark: write an SVG, then `import_graphic` (writing-circuits.md).
9. **Fine tuning.** `board_summary` `{ file }` reads the board: `main.circuit.tsx: Board 42 × 28 mm,
   2 layers, courtyards use 38%; 24 parts, 18 nets`, one line per part
   (`U1 MCP2515 soic18w @(12.0, 8.5) r90 top [LOCKED]`), the ten longest connections with both pads' places,
   `Courtyards overlap (n):`, `Off the board (n):`, `Pours:` and `Unrouted: N connections`. `render` `{ file }`
   is your eyes, a PNG of the board as the person sees it: look after `autoplace` and after `autoroute`; `parts` zooms; `out: "pics/top.png"` also writes it.
   Move a part with `set_props` `{ pcbX, pcbY, pcbRotation }` only for a reason, never one the human placed unless asked.
10. **Rules, then pours.** Wider power tracks, a clearance or 4 layers before routing: `set_rules` `{ rules: { netClasses: { power: { nets: ["GND", "V5"], trackWidth: 0.5 } } } }` ([references/design-rules.md](references/design-rules.md)). **Pours.** `add_pour` `{ file, net: "GND", layer: "top" }` on the layer the parts sit on:
    `Change …: added copperpour:1 (GND, top)` and `copperpour:1 GND top: … mm², joins N pads`.
    On a two-layer board pour GND on both layers (`top` and `bottom`) before `autoroute`.
11. **Route.** `autoroute` `{ file }`: `Change …: Routed 30 of 32 connections in 2 passes;
    unrouted: C3.pin2 (12.30, 4.50 top) to U2.pin2 (15.10, 6.00 top) (…)`. Route each one it
    reports with `route_track` `{ file, from: "C3.pin2", to: "U2.pin2" }` (the router's search for
    that one connection; add `via` points to draw it yourself), or move the part and `autoroute`
    again; `N connections wait for parts that are not placed: J1`: place it (step 7), then `autoroute`. Details in [references/copper.md](references/copper.md) (`route_track`, `add_via`,
    `remove_copper`, `fillet_tracks`, `straighten_tracks`, `unroute`, `copper_summary`, `remove_pour`, `remove_hole`).
12. **Check.** `check_circuit` `{ file, filter? }`: `main.circuit.tsx: 0 errors, 2 warnings`, then
    up to 20 findings, one line each (`error pin-unconnected [U1.pin3]: …`).
13. **Export.** For a board to be made: after `autoroute` and a clean `check_circuit` (0 errors
    and no `unrouted` warning), call `export_fabrication` `{ file }`: `Wrote 12 files to
    main-fab/ and main-fab.zip:`; a design with errors is `Refused: no fabrication files were
    written.` An export with unrouted connections is written with a warning and is NOT a finished
    board: say so, and route them first (step 11). Pass on every `Warning:` line; `out` writes into
    another project folder. A person uploads the zip to JLCPCB; you do not. `export_package` writes the BOM and datasheets folder.
14. **Remember, throughout.** `note_decision` `{ text, file? }` as each choice is made that a
    later context needs (a part and why, a board size, what the person approved; at most 500
    characters each), not batched at the end: `Change …: noted under Decisions in PROJECT.md`.
    Keep `set_project`'s blocks and open items current.

## Checking

`check_circuit` lists the first 20 findings; `filter` takes `errors`, `warnings`, `copper`, a
part, a net or an instance. Electrical checks (`pin-unconnected`, `output-conflict`,
`no-power-source`), placement checks (`courtyard-overlap`, `outside-board`), copper and pour
checks, and code and model problems: `footprint`, `unknown-pin`, `ambiguous-pin` (write
`pin<n>` instead), `library-override`. `auto-route` (a warning: a schematic wire drawn
straight because symbols stand too close for a way round) is fixed by moving a symbol with
`set_props` `{ schX, schY }`. Fix every error before you report success. Warnings do not fail
the check; mention them, but `unrouted` means the board is not finished (step 13). A part not
placed yet gets only the `unplaced` warning. Net classes and fabrication limits live
in `rules.yaml` at the project root; change them with `set_rules`, never work around a rule in the circuit.

## Rules

- Never move, change or remove a `[LOCKED]` part. If you think a locked part must change,
  ask the human to unlock it.
- If a summary lists lock violations, restore those parts to their locked values first.
- Treat marks as instructions placed on the board. Mention which marks you addressed.
- You may undo your own changes with `undo_change` `{ id? }`. You cannot undo the human's
  changes.
- A pour or hole is locked by its id, not by a part's lock; leave a locked one alone. A locked
  part guards only the tracks that start on its pads; leave vias on it and tracks ending there
  alone unless the human asks.
- Parts shown `[read-only: …]` cannot be edited by the tools; ask the human to change them.
- Leave `schX`, `schY`, `pcbX`, `pcbY` and `schematicRouteHints` of parts the human placed alone
  unless they ask for a new position.
- Add chips through the parts library (`create_part`, then `place_part`), never as inline
  `<chip>` elements with hand-written pins. Only the human marks a library part verified.
- Change circuit files through these tools wherever one does the change: they enforce locks and
  record history. Write code by hand only for what no tool writes, and keep it editable: see
  [references/editable-subset.md](references/editable-subset.md).
- A passing build is not proof that a circuit is correct. Check connections against the
  datasheets and say what you did not verify.

## References

- [references/design-workflow.md](references/design-workflow.md): a two-channel sensor board
  from an empty project to the export, as tool calls and their answers.
- [references/copper.md](references/copper.md): placing, routing, pours and holes in detail.
  Read before routing or drawing copper.
- [references/writing-circuits.md](references/writing-circuits.md): what a part in
  `new_circuit` means, `replace`, refused pins, read-only parts, the export's warnings.
- [references/editable-subset.md](references/editable-subset.md): how to write circuit code
  the human can still edit visually. Read before writing new parts.
- [references/design-rules.md](references/design-rules.md): starter design rules (decoupling,
  trace width, USB-C, indicators). Read before placing power parts or connectors.
- [references/parts-library.md](references/parts-library.md): how to add a chip from its
  datasheet or a photo with `create_part`. Read before adding any part that is not a passive.
