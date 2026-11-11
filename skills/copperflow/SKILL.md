---
name: copperflow
description: Work on copperflow circuit projects, where tscircuit *.circuit.tsx files are edited by a human and an agent together. Use when designing a board, placing, moving, connecting or removing parts in a *.circuit.tsx file, or when the user mentions copperflow, PROJECT.md, locked parts, marks or undoing a change.
---

# Working in a copperflow project

A human edits the same circuit files you do. They lock parts they have placed, leave marks
with instructions, and undo changes they do not want. Your job is to make progress without
undoing their work. Every tool answers in a few lines that say what it did; read the answers,
not the files.

## Every task

1. `project_status` `{}` first. It answers with PROJECT.md (`Intent: …`, `Blocks:`, the last
   five `Decisions:`, `Open:`), then one line per circuit
   (`main.circuit.tsx: parts 12, nets 9, unplaced 0, unrouted 3, errors 0, warnings 2`) and its
   last three changes. `No PROJECT.md yet` means a new project: start the design workflow.
2. For the file in hand, `circuit_summary` `{ file }`: one line per part and per net, then
   `Locked:`, the marks (`Mark <id> (pcb x, y): …`) and `Lock violations:`. Use
   `detail: "full"` only when you need every prop; `filter: "PS1"` shows one instance.
3. `recent_changes` `{ limit? }`: newest first; a change marked `[undone]` was rejected by the
   human: do not make it again unless they ask. `list_circuits` lists the circuit files.
4. Do the work (below), then `check_circuit` once at the end, then tell the human what you
   changed and the change ids (`c0012`), so they can undo a single step.

## The design workflow

For a new board, or a new block on one, work in this order. Each step names the tool and the
first line of its answer. The worked example is in
[references/design-workflow.md](references/design-workflow.md).

1. **Intent.** `set_project` `{ intent, blocks: [{ name, does, status }], open }` writes
   PROJECT.md: `Change c0001: Intent, Blocks, Open written to PROJECT.md`. Update a block's
   status the same way as it moves on (`designed`, `placed`, `routed`).
2. **Blocks first.** One sub-sheet per block (power, MCU, a sensor channel, a connector).
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
3. **Design each block.** Write parts and connections, not positions or wire corners: the
   program places and routes. `edit_circuit` `{ file, edits: [...] }` applies a list as one
   change (`Change c0004 applied: 3 edits: …`; nothing written if one is refused, and the answer
   says which). `connect_nets` `{ file, nets: { GND: ["R1.pin2", "C1.pin2"] } }` answers
   `connected 4 pins (GND +4)`. Single edits: `place_part`, `set_props`, `remove_part`,
   `add_trace`, `remove_trace`. These tools enforce locks and record history; editing the file
   directly does not. Labels move with `set_props` `schNameAt`, `schValueAt`, `pcbNameAt`
   (a point `{ x, y }` from the part's origin; `null` puts it back).
4. **Clone channels as instances.** Another use of a block is `edit_circuit`'s `add_instance`
   `{ sheet, name, connections }`; `set_connections` rewires one. Never copy its parts.
5. **Choose parts**, in this order: a part already in `list_parts` (one line each,
   `id <chip> title footprint verified|NOT verified`; `part_info` `{ id }` shows its part.yaml);
   a built-in part with a generated footprint string (`resistor` with `"0402"`, a chip with
   `"soic8"`); `create_part` from the datasheet (`Created <id>: <title>, N pins, footprint …`,
   `It is NOT verified: …`); `import_part` `{ lcsc }` only when the human asks for an LCSC
   number (`Imported C7950 as <id>: …`). An import is for personal, non-commercial use only and
   is always unverified. See [references/parts-library.md](references/parts-library.md).
   `bom` `{ file }` lists what the board uses.
6. **Ask the person before the PCB.** Stop here. Run `check_circuit` and fix its errors, then
   summarise the blocks and the parts chosen (and which are unverified) and ask whether to go on
   to the board. Wait for a yes; `note_decision` what they approved.
7. **Place block by block.** `autoplace` `{ file, instance: "CH1" }` or `{ file, parts: [...] }`
   (one change): `Placed 12 parts; wire length 184 mm (was 412); board 42 × 28 mm; 0 overlaps`,
   then `Change c0007; undo_change takes it back.`, then `Not placed:` and `Notes:` if any. Place
   the block with the most connections (the MCU) first, then the others, then the connectors.
   Parts a person placed or locked stay and are worked round. A sheet holds one layout for all
   its instances: the first one placed sets it, and `autoplace` moves each other instance as a
   whole by its anchor (`{ instance: "CH2" }`, or the whole board), noting `CH2 was moved as a block`.
8. **Board shape and connectors.** `fit_board` `{ file, margin? }`:
   `Change c0010: board 42 × 28 mm (margin 2 mm)`; or `autoplace` with `fit: true`.
   Mounting holes with `add_hole` `{ file, x, y, diameter }`.
9. **Fine tuning.** `board_summary` `{ file }` is your eyes: `main.circuit.tsx: Board 42 × 28 mm,
   2 layers, courtyards use 38%; 24 parts, 18 nets`, one line per part
   (`U1 MCP2515 soic18w @(12.0, 8.5) r90 top [LOCKED]`), the ten longest unrouted connections,
   `Courtyards overlap (n):`, `Off the board (n):`, `Pours:` and `Unrouted: N connections`. Move
   a part with `set_props` `{ pcbX, pcbY, pcbRotation }` only when the summary shows a reason.
10. **Pours.** `add_pour` `{ file, net: "GND", layer: "top" }` on the layer the parts sit on:
    `Change …: added copperpour:1 (GND, top)` and `copperpour:1 GND top: … mm², joins N pads`.
11. **Route.** `autoroute` `{ file }`: `Change …: Routed 30 of 32 connections in 2 passes;
    unrouted: …`. Route by hand only what the router reports. Details in
    [references/copper.md](references/copper.md) (`route_track`, `add_via`, `remove_copper`,
    `fillet_tracks`, `straighten_tracks`, `unroute`, `copper_summary`, `remove_pour`,
    `remove_hole`).
12. **Check.** `check_circuit` `{ file, filter? }`: `main.circuit.tsx: 0 errors, 2 warnings`, then
    up to 20 findings, one line each (`error pin-unconnected [U1.pin3]: …`).
13. **Export.** For a board to be made: after `autoroute` and a clean `check_circuit`, call
    `export_fabrication` `{ file }`: `Wrote 12 files to main-fab/ and main-fab.zip:`; a design
    with errors is `Refused: no fabrication files were written.` and nothing is written. Pass on
    its warnings. A person uploads the zip to JLCPCB; you do not. `export_package` writes the
    BOM and datasheets folder.
14. **Remember.** `note_decision` `{ text, file? }` for every choice a later context needs (a part
    and why, a board size, what the person approved): `Change …: noted under Decisions in
    PROJECT.md`. Keep `set_project`'s blocks and open items current.

## Checking

`check_circuit` lists the first 20 findings; `filter` takes `errors`, `warnings`, `copper`, a
part, a net or an instance. Electrical checks (`pin-unconnected`, `output-conflict`,
`no-power-source`), placement checks (`courtyard-overlap`, `outside-board`), copper and pour
checks, and code and model problems: `footprint`, `unknown-pin`, `ambiguous-pin` (write
`pin<n>` instead), `library-override`. Fix every error before you report success. Warnings
such as `unrouted` do not fail the check; mention them. Net classes and fabrication limits live
in `rules.yaml` at the project root; do not work around a rule in the circuit.

## Rules

- Never move, change or remove a `[LOCKED]` part. If you think a locked part must change,
  ask the human to unlock it.
- If a summary lists lock violations, restore those parts to their locked values first.
- Treat marks as instructions placed on the board. Mention which marks you addressed.
- You may undo your own changes with `undo_change` `{ id? }`. You cannot undo the human's
  changes.
- Add chips through the parts library (`create_part`, then `place_part`), never as inline
  `<chip>` elements with hand-written pins. Only the human marks a library part verified.
- Writing new parts directly in the file is fine. Keep them editable: see
  [references/editable-subset.md](references/editable-subset.md).
- A passing build is not proof that a circuit is correct. Check connections against the
  datasheets and say what you did not verify.

## References

- [references/design-workflow.md](references/design-workflow.md): a two-channel sensor board
  from an empty project to the export, as tool calls and their answers.
- [references/copper.md](references/copper.md): placing, routing, pours and holes in detail.
  Read before routing or drawing copper.
- [references/editable-subset.md](references/editable-subset.md): how to write circuit code
  the human can still edit visually. Read before writing new parts.
- [references/design-rules.md](references/design-rules.md): starter design rules (decoupling,
  trace width, USB-C, indicators). Read before placing power parts or connectors.
- [references/parts-library.md](references/parts-library.md): how to add a chip from its
  datasheet or a photo with `create_part`. Read before adding any part that is not a passive.
