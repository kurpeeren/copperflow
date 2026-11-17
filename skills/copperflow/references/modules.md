# Modules: blocks that describe themselves, and a shelf to keep them on

A sheet (`<Name>.sheet.tsx`) is a block used as instances. Its **card** says what it is, in the
same file: what it does, where it comes from, and for each port its type and what it carries. A
person keeps the blocks they approved on a **shelf** of modules, outside any project, so the next
board starts from them instead of from nothing.
(Without this skill installed, `guide { "topic": "modules" }` returns this page.)

## The card

```tsx
<sheet does="24 V digital input: divider, clamp, RC filter" sources={["https://example.com/app-note.pdf"]}>
  <port name="IN" type="input" carries="0 to 24 V from the field, 5 mA at most" />
  <port name="OUT" type="output" carries="0 to 3.3 V logic to the controller" />
  <port name="GND" type="ground" />
  …
</sheet>
```

- `does`: one line, at most 160 characters: the job, and the numbers that choose it over another
  block. `24 V digital input: divider, clamp, RC filter` says more than `Input stage`.
- `sources`: at most 8 links or document names (datasheet, application note, the page of a
  reference design) the block was designed from, so the next person can check it.
- A port's `type` is the instance's pin type: `power_in`, `power_out`, `ground`, `input`,
  `output`, `bidirectional` or `passive` (the default). `check_circuit` then sees across blocks:
  two outputs joined, or a power input with nothing that supplies it.
- A port's `carries`, at most 80 characters: the range, the limit and the direction of energy.
  `9 to 24 V in, 300 mA`, `3.3 V out, 500 mA at most`, `0 to 3.3 V logic, 1 kHz`, `RS-485 A line`.
  Not the name again (`IN input`).

Write a card with the sheet: `new_circuit`'s `sheets` take
`{ parts, nets, ports, does, sources }`, a port being a name or `{ name, type, carries }`. For a
sheet that exists, `describe_sheet { file, does, sources, ports: { IN: { type, carries } } }` is one
change the person can undo. `circuit_summary` on the sheet file, or with `filter` naming an
instance, shows the card.

## Before designing a block: the shelf

1. `list_modules { filter }`: one line a module, its job, its ports and whether a person verified
   it. A module that does the job is used, not designed again.
2. `module_info { name }`: the card, the parts with values and footprints, the sources, where it
   was saved from. Read it before using one.
3. `use_module { module, file }` copies the module's sheet beside the circuit `file` (and its
   library parts the project does not have), then says how to place it with `edit_circuit`'s
   `add_instance`. A different sheet of that name in the project is refused.
4. Say to the person which modules you used and whether each is verified. A module that is NOT
   verified is a draft: check it as you would your own block.

## Checking a block's voltages: simulate and cases

Run `simulate` before a block is built, when its job is a voltage or a current: a divider, a clamp,
a switch that must be fully on, a resistor that must not burn. `simulate { file, set: { V12: 12,
GND: 0, CTRL: 3.3 }, sheet?, closed?, coil? }` gives each net's voltage, each source's current and
the power drawn, then the parts beyond a limit (a resistor's power against its package, a diode's
current against `ifmax`, a MOSFET neither off nor fully on, a capacitor over `voltageRating`), then
each part. A net set to `"open"` floats; `closed` names switches, `coil` relays that are energised.

What it is: a DC operating point from ideal sources and simple models (resistors, diodes and LEDs
fitted to `vf` at `vfAt`, zeners to `vz` at `vzAt` and `zz`, MOSFETs to `vth` and `rdson` at
`rdsonAt`, transistors to `hfe` and `vbe` at `vbeAt`, relay coils). What it does not know: time,
frequency, temperature, tolerance; chips are not modelled, their pins draw nothing unless the part's
`model` gives `loads`. A diode or LED with no figures uses generic ones marked assumed; a transistor
or MOSFET with none is refused. A library part carries `model:` in part.yaml with the datasheet page
of each figure; each figure is an item of its verification checklist.

A sheet's card can carry `cases` (write them with `describe_sheet`): `[{ name, set, closed?, coil?,
expect: { OUT: [3.2, 3.6], "K1.coil.i": [0.027, 0.033] } }]`. A figure is a net's voltage, or a
part's `.v`, `.i`, `.p` (`Q1.vgs` for a MOSFET, `K1.coil.i` for a relay). `simulate { file, sheet
}` with no `set` runs them, one line each; `module_info` shows the last result. A case that passes
shows the block's DC levels with the models given, not that the module is verified. If a case shows
a block not doing what its card says, say so to the person; do not change the case or the figures
until it passes. `copperflow spice <file> --out x.cir` writes the same circuit for another
simulator.

## After the person approved a board: save_module

`save_module { file: "Input.sheet.tsx", name, replace }` copies a sheet and its library parts to
the shelf. Only after the person has approved the board, and only blocks worth keeping. It is
refused when the card is missing `does` or a port has neither a type nor what it carries (write them
with `describe_sheet`), when the sheet does not build, and when the name is taken unless `replace`.
A module is one sheet with library parts; a sheet that imports other sheets is not saved.

## Only a person verifies

A saved module is NOT verified. The person checks it and runs, at a terminal,
`copperflow modules verify <name> --by <name>`. The mark holds the hash of the sheet's text: a sheet
that changes afterwards reads NOT verified again. No tool verifies a module or a part; do not ask
for a way around that. `copperflow modules` lists the shelf, `copperflow modules remove <name>` takes
one off. The shelf is `~/.copperflow/modules/`, or the folder `COPPERFLOW_MODULES` names.

## Libraries

Besides the shelf, modules come from libraries: `copperflow`, which ships with copperflow, and the
ones the person added from a git address or a folder. `list_modules` lists the shelf, then each
library; a library's module is named `<library>/<Name>` (`copperflow/Input`), and `module_info` and
`use_module` take that name. `use_module` brings a library's sheet only when it is plain (part
imports, one function returning tags with literal values) and writes its parts' component files
itself; a sheet that is not plain is refused with the first thing found and its line. The history
entry says which library the sheet came from.

A library's modules are NOT verified here until the person runs
`copperflow modules verify <library>/<Name> --by <name>`; anything a library says about itself counts
for nothing. Adding a library is the person's choice, by command only:
`copperflow library add <name> <git address or folder> [--ref <branch or tag>]`,
`copperflow library update [name]`, `copperflow library remove <name>`, `copperflow library` to list.
Asked to add one, tell the person the command; run it only if they asked you to and you have a shell.
