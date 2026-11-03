---
name: copperflow
description: Work on copperflow circuit projects, where tscircuit *.circuit.tsx files are edited by a human and an agent together. Use when placing, moving, connecting or removing parts in a *.circuit.tsx file, or when the user mentions copperflow, locked parts, marks or undoing a change.
---

# Working in a copperflow project

A human edits the same circuit files you do. They lock parts they have placed, leave marks
with instructions, and undo changes they do not want. Your job is to make progress without
undoing their work.

## Every task

1. Call `circuit_summary` for the file before changing it. Read it fully: `[LOCKED]` parts,
   `[read-only: ...]` parts, "Marks from the human" and lock violations.
2. Call `recent_changes`. A change marked `[undone]` was rejected by the human: do not make it
   again unless they ask.
3. Change existing parts and traces with `set_props`, `remove_part`, `add_trace` and
   `remove_trace`. These tools enforce locks and record history; editing the file directly does not.
4. After any placement change, call `check_circuit`. Fix placement errors such as
   `pcb_courtyard_overlap_error` first: they stop autorouting, so the unrouted-port errors
   that follow them usually disappear once placement is fixed. Do not report success while
   the build fails.
5. Tell the human what you changed and the change ids, so they can undo a single step.

## Rules

- Never move, change or remove a `[LOCKED]` part. If you think a locked part must change,
  ask the human to unlock it.
- If a summary lists lock violations, restore those parts to their locked values first.
- Treat marks as instructions placed on the board. Mention which marks you addressed.
- You may undo your own changes with `undo_change`. You cannot undo the human's changes.
- Writing new parts directly in the file is fine. Keep them editable: see
  [references/editable-subset.md](references/editable-subset.md).
- A passing build is not proof that a circuit is correct. Check connections against the
  datasheets and say what you did not verify.

## References

- [references/editable-subset.md](references/editable-subset.md): how to write circuit code
  the human can still edit visually. Read before writing new parts.
- [references/design-rules.md](references/design-rules.md): starter design rules (decoupling,
  trace width, USB-C, indicators). Read before placing power parts or connectors.
