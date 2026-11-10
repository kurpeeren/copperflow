---
name: copperflow
description: Work on copperflow circuit projects, where tscircuit *.circuit.tsx files are edited by a human and an agent together. Use when placing, moving, connecting or removing parts in a *.circuit.tsx file, or when the user mentions copperflow, locked parts, marks or undoing a change.
---

# Working in a copperflow project

A human edits the same circuit files you do. They lock parts they have placed, leave marks
with instructions, and undo changes they do not want. Your job is to make progress without
undoing their work.

## Every task

1. Call `circuit_summary` for the file before changing it (the default answer is compact; use
   `detail: "full"` only when you need every prop). Read it fully: `[LOCKED]` parts,
   `[read-only: ...]` parts, "Marks from the human" and lock violations.
2. Call `recent_changes`. A change marked `[undone]` was rejected by the human: do not make it
   again unless they ask.
3. For a new design, call `new_circuit` once with the parts (`kind` for a built-in part such as
   `resistor`, `part` for a library id, `value`, `footprint`) and the nets (`{ GND: ["R1.pin2",
   "U1.GND"] }`); it writes the file, refuses unknown pins and lists the real ones. An existing
   file needs `replace: true`.
   Write parts and connections, not positions or wire corners: the program places and routes.
   Change existing parts and traces with `set_props`, `remove_part`, `add_trace` and
   `remove_trace`, or several at once with `edit_circuit` (one history entry; nothing is written
   if one edit is refused) and `connect_nets` (`{ GND: ["R1.pin2", "C1.pin2"] }`). These tools
   enforce locks and record history; editing the file directly does not.
   Copper: you may draw the tracks and vias you want by hand with `route_track` (a track of one
   net, starting on a pad, track or via of that net), `add_via` and `remove_copper`; each is one
   history entry, and the answer lists the copper violations the change introduced. The program
   checks clearance; the router comes later and does the rest. Order: `copper_summary` first (per net: tracks, vias,
   length, unrouted connections), then your copper changes, then `check_circuit` once at the end
   (filter `copper` for the full list). A locked part guards only the tracks that start on its
   pads; vias on it and tracks that only end there are not locked, so leave them alone unless
   the human asks.
4. Call `check_circuit` once at the end (it lists the first 20 findings; `filter` takes `errors`,
   `warnings`, `copper`, a part or a net). It runs copperflow's own rule checks: the electrical
   checks (`pin-unconnected`, `output-conflict`, `no-power-source`), the placement checks
   (`courtyard-overlap`, `outside-board`) and the problems in the code and the model, one line each
   with the rule, the items and the position: `footprint` (a footprint it cannot make), `unknown-pin`, `ambiguous-pin` (a name
   several pins share; write `pin<n>` instead), `library-override` (an instance sets a prop its
   library part owns) and so on. Fix every error before you report success. Warnings such as
   `unrouted` do not fail the check; mention them. Net classes and fabrication limits live in
   `rules.yaml` at the project root; do not work around a rule in the circuit.
5. Tell the human what you changed and the change ids, so they can undo a single step.

## Rules

- Never move, change or remove a `[LOCKED]` part. If you think a locked part must change,
  ask the human to unlock it.
- If a summary lists lock violations, restore those parts to their locked values first.
- Treat marks as instructions placed on the board. Mention which marks you addressed.
- You may undo your own changes with `undo_change`. You cannot undo the human's changes.
- Add chips through the parts library (`create_part`, then `place_part`), never as inline
  `<chip>` elements with hand-written pins. Only the human marks a library part verified.
- Writing new parts directly in the file is fine. Keep them editable: see
  [references/editable-subset.md](references/editable-subset.md).
- A passing build is not proof that a circuit is correct. Check connections against the
  datasheets and say what you did not verify.

## References

- [references/editable-subset.md](references/editable-subset.md): how to write circuit code
  the human can still edit visually. Read before writing new parts.
- [references/design-rules.md](references/design-rules.md): starter design rules (decoupling,
  trace width, USB-C, indicators). Read before placing power parts or connectors.
- [references/parts-library.md](references/parts-library.md): how to add a chip from its
  datasheet or a photo with `create_part`. Read before adding any part that is not a passive.
