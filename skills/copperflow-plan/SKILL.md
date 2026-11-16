---
name: copperflow-plan
description: Plan a new circuit board in a copperflow project before any circuit file is written. Use when the person asks for a new board, circuit, PCB or module, or a new block on one. Asks the person every question the design needs, splits the board into blocks with named ports (a repeated function is one block and a count), and gives each block to a sub-agent.
---

# Planning a copperflow board

Do this before the first `new_circuit`, also when the request looks simple.

The whole method is in the copperflow skill's planning reference: read
[../copperflow/references/planning.md](../copperflow/references/planning.md) (or call the
copperflow server's `guide` tool with `{ topic: "planning" }`) and follow it in order:

1. **Ask everything first**, in one numbered message with your defaults: purpose, counts of
   everything that repeats, power, outside connections, parts, signals that set rules, the board,
   bring-up, conditions.
2. **The block tree.** Each block does one job and has named ports; a repeated function is one
   block and a count; power first. Write it with `set_project` and get the person's yes.
3. **One sub-agent per block**, which sends back the block as one sheet (`parts`, `nets`,
   `ports`) and writes no circuit file.
4. **Put the blocks together** with one `new_circuit` (`sheets` and `instances`), then
   `check_circuit`.

After the plan, go on with the copperflow skill's design workflow at "Ask the person before the
PCB".
