# copperflow

Design circuits in code while a human and an AI agent edit the same files.

Circuits are TSX files written with [tscircuit](https://github.com/tscircuit/tscircuit)'s
elements, such as `<board>`, `<resistor>` and `<trace>`. copperflow builds and draws them with
its own engine. You and your agent work on them together:

- the agent changes the circuit through an MCP server, and every change is one undo step;
- you lock the parts you have placed, and the agent cannot move or change them;
- you leave marks such as "route ground here", and the agent reads them;
- edits are written back as minimal text changes, so the rest of your code stays as you wrote it.

Everything runs locally. There is no chat inside copperflow: use the agent you already use,
for example Claude Code, through MCP.

> **Status: 0.3, early.** The core, the MCP server, the CLI, the visual editor and the parts
> library work. The project hierarchy for large boards is next; see [docs/design.md](docs/design.md).

## Quick start

Requires Node.js 22 or newer. copperflow is not on npm yet, so install it from source:

```bash
git clone https://github.com/kurpeeren/copperflow.git
cd copperflow
npm install
npm run build
npm link
```

Try it on the example board:

```bash
copperflow summary --root examples/usb-c-ldo index.circuit.tsx
```

`copperflow check` (and the agent's `check_circuit`) lists two kinds of problems until
copperflow's own rules and checks arrive in stage 2 of [the engine design](docs/engine-design.md#stages):

- the engine's errors and warnings, the same ones the Studio shows, grouped by code: a footprint
  it cannot make (`footprint`), a pin that does not exist (`unknown-pin`) or that several pins
  share (`ambiguous-pin`), an instance that overrides its library part (`library-override`) and
  so on. Engine errors fail the check;
- the tscircuit CLI's errors and warnings, such as overlapping courtyards and unrouted ports.
  tscircuit cannot read a part's `footprint.yaml`, so its errors about that footprint, and about
  ports left unconnected because that part has no pads there, are left out.

For the second part, run `npm install -g tscircuit`, and set `COPPERFLOW_TSCI` if it is not on your PATH.

### Connect Claude Code

From your circuit project:

```bash
claude mcp add copperflow -- copperflow mcp
```

Then copy the skill so the agent knows the workflow:

```bash
mkdir -p .claude/skills
cp -r /path/to/copperflow/skills/copperflow .claude/skills/
```

Any other MCP client can run `copperflow mcp` over stdio from the project folder
(or pass `--root <dir>`).

### Open the visual editor

```bash
copperflow studio --root examples/usb-c-ldo
```

Then open the address it prints. The address carries a key for this session, so other web
pages and other programs on your computer cannot use the editor's API.

The schematic and the PCB are drawn from the design copperflow's engine builds, with
copperflow's own footprints and schematic symbols. The PCB shows the ratsnest, a straight line
for each connection still to be made, until routing arrives: hand routing in stage 4 and the
router in stage 5 of [the engine design](docs/engine-design.md#stages).

Drag parts on the PCB (they snap to a 0.1, 0.5 or 1 mm grid), press R to rotate and Delete to
remove, scroll to zoom, drag the background to pan, lock parts, change values in the inspector,
move symbols in the schematic and draw wires as in KiCad (click a free pin, or press W over a pin,
click the sheet for corners on the grid, then click a pin, a net label or a wire; Esc cancels),
leave marks for the agent and undo changes.
Drag a net label or a ground or power symbol in the schematic and its wire follows, written as `schematicRouteHints` on the trace (Esc cancels the drag).
Every edit is written back into the circuit file and shows at once.
When the agent changes the file, the editor updates by itself.

The Library tab places parts from your library or the built-in parts (resistor, capacitor, LED
and so on). Selecting a library part shows its maker, MPN, supplier number, datasheet and
checklist, and lets you mark it verified. With nothing selected, the right panel shows the bill
of materials and exports it with the datasheets.

## How it works

**The editable subset.** copperflow only writes back to code it can read without running it:
a part needs a string-literal `name`, and a prop is editable when its value is a literal such
as `pcbX={4.5}` or `resistance="10k"`. Parts inside `.map()` or with spread props, and
expressions such as `pcbX={x + 2}`, are shown as read-only. Nothing else is restricted.

**Locks and marks.** They live next to the circuit in `board.circuit.annotations.json`, so
they stay out of the circuit code and git keeps them. Only you lock and unlock. The agent's tools
refuse to touch locked parts, and every summary reports a locked part that was changed some
other way.

**Parts library.** Chips and connectors live in `parts/<id>/part.yaml` in your project: pins
with names and electrical types, a footprint, MPN and supplier numbers. The footprint is either a
string such as `sot23_5`, from which copperflow makes the pads (the strings it knows are listed in
[editable-subset.md](skills/copperflow/references/editable-subset.md#footprint-strings)), or
`footprint.yaml`, a file next to `part.yaml` with every pad transcribed from the datasheet's
recommended land pattern; the example's USB-C connector has one. copperflow generates the part's
component from `part.yaml`. The agent creates parts from datasheets; they stay *not verified*
until you check `verification.md`, which covers `footprint.yaml` too, and run
`copperflow parts verify`.

**BOM and datasheet package.** `copperflow bom` groups parts by value, footprint and part
number; `copperflow package` writes the BOM, the local datasheets and every library part's
verification status into one folder. Both read the design copperflow builds from the circuit code,
so parts made in loops are counted, and supplier numbers come from the code and the library; there
is no `--build` option.

**History.** Every change made through copperflow is stored in `.copperflow/history/` with
who made it. `copperflow undo` reverts the newest change; the agent can undo only its own.
The agent sees what you undid and does not repeat it.

## MCP tools

| Tool | What it does |
|------|--------------|
| `list_circuits` | Lists the `*.circuit.tsx` files in the project |
| `circuit_summary` | Parts, props, traces, locks, marks and lock violations of one file |
| `set_props` | Sets literal props: position, rotation, value, footprint |
| `remove_part` | Removes a part and its traces |
| `add_trace` / `remove_trace` | Connects or disconnects two ports or nets |
| `check_circuit` | Lists the engine's errors and warnings, then those of a tscircuit build, such as overlapping parts |
| `list_parts` / `part_info` | Shows the parts library and a part's data and checklist |
| `create_part` | Adds a part from a datasheet: pins, footprint string or footprint file, MPN, suppliers |
| `place_part` | Adds a library or built-in part to a circuit, with its import |
| `bom` / `export_package` | Bill of materials; folder with BOM, datasheets and part status |
| `recent_changes` | Recent changes by you and the agent, including undos |
| `undo_change` | Undoes one of the agent's own changes |

There is no unlock tool and no verify tool on purpose.

## CLI

```text
copperflow mcp                              start the MCP server on stdio
copperflow studio [--port n]                open the visual editor at http://127.0.0.1:4777
copperflow summary <file>                   print a circuit summary
copperflow check <file>                     list the engine's errors and warnings, then tscircuit's
copperflow lock <file> <part...>            lock parts so the agent cannot change them
copperflow unlock <file> <part...>          unlock parts
copperflow mark <file> <text> [--pcb x,y | --sch x,y]
                                            leave a note for the agent
copperflow unmark <file> <id>               remove a note
copperflow parts                            list the parts library
copperflow parts build                      regenerate part components after editing part.yaml
copperflow parts verify <id> --by <name> --against <datasheet, page>
                                            mark a part as checked against its datasheet
copperflow place <file> <part> <name> [key=value ...]
                                            add a library or built-in part to a circuit
copperflow bom <file> [--csv]               print the bill of materials
copperflow package <file> [--out dir]
                                            write BOM, datasheets and part status to a folder
copperflow history [--limit n]              list recent changes
copperflow undo [id]                        undo the newest change, or the given one
```

## Roadmap

- **0.2** (done) Visual editor in the browser: drag, rotate, lock, delete and reconnect wires, marks.
- **0.3** (done) Parts library (one folder per part) and datasheet-to-part import; BOM and datasheet package.
- **0.4** Project hierarchy for large boards: a project map, blocks with interfaces, generated summaries, project rules.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). "copperflow" refers to this
project; the license does not grant rights to the name.

The visual editor bundles open-source packages (React, MIT). Their licences ship in
`dist/app/THIRD_PARTY_LICENSES.txt`.
