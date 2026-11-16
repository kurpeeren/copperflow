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

Requires Node.js 22 or newer.

```bash
npm install -g copperflow
```

To work on copperflow itself, install it from source instead:

```bash
git clone https://github.com/kurpeeren/copperflow.git
cd copperflow
npm install
npm run build
npm link
```

Try it on the example board (in the source tree):

```bash
copperflow summary --root examples/usb-c-ldo index.circuit.tsx
```

`copperflow check` (and the agent's `check_circuit`) runs copperflow's own rule checks and nothing else, so no other tool needs to be installed:

- the electrical rules check (ERC): pins left unconnected, outputs driven together, nets without a power source and so on;
- the placement design-rule check (DRC): overlapping courtyards, parts off the board, pads and holes too close to each other;
- problems in the code and the model, the same ones the Studio shows: a footprint it cannot make (`footprint`), a pin that does not exist (`unknown-pin`) or that several pins share (`ambiguous-pin`), an instance that overrides its library part (`library-override`) and so on.

Design rules live in `rules.yaml` at the project root: a fabrication profile (JLCPCB 2-layer by default), net classes and global nets. The `usb-c-ldo` example shows a small one, and `skills/copperflow/references/design-rules.md` explains the format and every check.

The CLI groups findings by code, with their positions; the agent's `check_circuit` lists them one per line, errors first. Any error fails the check (exit code 1). Copper checks (clearance between nets, track width, via drill and ring, board edge, keepouts, shorts) cover the tracks and vias in the layout file.

### Connect Claude Code

From your circuit project:

```bash
claude mcp add copperflow -- copperflow mcp
```

The agent learns the workflow from the guide that comes with the server (the `guide` tool), so
nothing else is needed. To have the same text as a Claude Code skill, in `.claude/skills/copperflow`:

```bash
copperflow skill
```

`copperflow skill --global` installs it once for every project. Steps for other agents are at
<https://copperflow.kurpeeren.com/connect.html>.

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

The window is laid out like a desktop EDA editor:

- The menu bar (File, Edit, View, Place, Design, Route, Layout, Tools, Export, Settings, Help) runs
  every command Studio has, and shows the ones still to come greyed out, with the stage or round
  that brings them. The build status sits at its right end; click it to see the checks.
- The toolbar under it holds the open document's tools: undo, zoom and fit, the schematic's Place
  tools (component, wire, net label, ground, power), rotate, Check DRC and the PCB's unit, and at
  its right end the snap grid, the PCB's layer switches and Keep these positions.
- The strip at the left edge opens Project Design or Common Library. Project Design has four
  tabs: Page (the project's circuit files, each with its Schematic and PCB), Net (every net; click
  one to highlight it in both views), Component (the parts) and Object (the connections).
- The strip at the right edge opens Properties: the selected part in Basic, Footprint, Position,
  Connections, Library and Notes sections, or, with nothing selected, the build, the notes for the
  agent and the bill of materials, which it exports with the datasheets.
- Document tabs above the canvas switch between the open file's Schematic and PCB.
- The strip at the bottom opens Library, Log (the history, with undo), DRC (the build's errors and
  warnings, which are ringed on the canvas; click one to go to it) and Find Results.

The mouse, in both views:

- Click a part to select it; Shift or Ctrl and click adds it or takes it out.
- Drag the background to draw a selection box: left to right takes the parts inside it, right to left
  the parts it touches; with Shift or Ctrl held it adds to the selection.
- Drag a part to move it, or a selected part to move the whole selection; parts snap to the grid
  (0.1, 0.5 or 1 mm on the PCB).
- Drag with the right (or middle) button to pan, and scroll to zoom.
- Double click a part to edit it in Properties.
- Place → Note box, then drag a box, leaves a note for the agent.

Press R to rotate and Delete to remove, lock parts, change values in Properties, draw wires in the
schematic as in KiCad (click a free pin, or press W over a pin, click the sheet for corners on the grid,
then click a pin, a net label or a wire; Esc cancels) and undo changes.
Drag a net label or a ground or power symbol in the schematic and its wire follows, written as `schematicRouteHints` on the trace (Esc cancels the drag).
The Place tools in the schematic toolbar (Net label, Ground flag, Power flag) put a label on a pin you click, written as a trace with one corner, and stay armed until Esc (while one is armed, dragging the background pans); Tab names a label before you click.
A double click on a net label renames its net everywhere; on a ground or power flag it asks first.
Design → Highlight net lights every net of the selected part.

Keys, ignored while you type in a field:

- `W` or `Alt+W` wires, `Alt+N` places a net label, `Space` or `R` rotates, `Delete` removes, `F` or `K` fits
- `H` highlights the net under the pointer, `Shift+H` clears it
- `Q` switches the PCB between mm and mil (display only), `Shift+F` searches the library
- On the PCB `U` rounds the corners of the selected tracks (Edit → Fillet tracks; with nothing selected, every
  track after a confirm) and `Shift+U` straightens them again; Design → Design rules sets the radius
- `[`, `]` and `\` hide and show the left, right and bottom panels; the bottom panel comes back on the tab it had
- `Ctrl+Z` undoes the last change, `Ctrl+O` goes to the circuit files under Project Design → Page
- `Ctrl+A` selects every part, `Ctrl+F` opens the find box (Enter lists what matches in Find Results)
- The arrow keys move the selection one grid step, `Shift` and an arrow ten steps
- With several parts selected, `Space` or `R` turns them together about the centre of the selection
- A right click without moving opens the context menu on a part, a net label or the empty canvas;
  `Shift+F10` or the menu key opens it on the selected part from the keyboard
- `Esc` clears the selection and puts the tools away
- In the menu bar the arrow keys move between the menus and their items, Enter or Space runs an
  item and Esc closes the menu; in every row of tabs the arrow keys move between the tabs.
  Help → Keys lists every key.

Every edit is written back into the circuit file and shows at once.
When the agent changes the file, the editor updates by itself.

The Library, in Common Library and in the bottom strip, places parts from your library or the
built-in parts (resistor, capacitor, LED and so on). Selecting a library part shows its maker,
MPN, supplier number, datasheet and checklist in Properties, and lets you mark it verified.
Library → New part… writes a part from its datasheet with a live footprint preview, and
Library → Import by LCSC number… fetches one from EasyEDA; both leave it not verified.

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
component from `part.yaml`. The agent creates parts from datasheets, or `copperflow parts import
C7950` fetches one by its LCSC number from EasyEDA (see [licences](docs/licences.md) for what the
source allows: personal, non-commercial use only; parts with letter-numbered pins such as BGAs are
refused); they stay *not verified*
until you check `verification.md`, which covers `footprint.yaml` too, and run
`copperflow parts verify`. An imported footprint keeps EasyEDA's orientation, which is JLCPCB's,
so pick-and-place needs no correction; place it at `pcbRotation -90` to match a generated footprint
of the same package.

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
| `circuit_summary` | Compact by default (a line per part and net, locks, marks, lock violations); `detail: "full"` lists every prop and trace |
| `set_props` | Sets literal props: position, rotation, value, footprint; `schNameAt`, `schValueAt` and `pcbNameAt` take a point `{ x, y }` that moves the name, value or silkscreen designator from the part's origin; `null` removes one of those three |
| `remove_part` | Removes a part and its traces |
| `add_trace` / `remove_trace` | Connects or disconnects two ports or nets |
| `check_circuit` | Runs copperflow's own ERC and placement DRC: counts, then up to 20 findings, one line each; `filter` narrows by severity, `copper`, part or net; copper clearance, width, via, board-edge and keepout violations are included |
| `new_circuit` | Writes a whole new circuit from a netlist in one call: parts (a built-in `kind` or a library `part`, `value`, `footprint`, `props` such as `pinCount` or a `pinLabels` object to name pins, no positions) and `nets` (`{ GND: ["R1.pin2", "U1.GND"] }`, no wire corners). Pins are checked first (a wrong one is refused with the part's real pin names); an existing file needs `replace: true`; one history entry, and undo removes the file. It then places the board (`autoplace`, a second entry; the board is fitted when no `board` size is given) unless `place: false` |
| `autoplace` | Places the parts nobody placed or locked (or only `parts`, or one `instance`) by their connections, as one change: answers "Placed 12 parts; wire length 184 mm (was 412); board 42 × 28 mm; 0 overlaps", then the parts it found no room for and its notes; `fit: true` fits the board too; `budgetSeconds` (20 s by default); `connectors: "ahead"` tries each connector beside the part it serves (route and compare before keeping it) |
| `fit_board` | Shrinks or grows a rectangular board to the parts' courtyards plus `margin` (2 mm by default), as one change |
| `import_board` | Sets the board's outline, mounting holes and keepouts from a DXF drawing in the project folder, as one change |
| `edit_circuit` | Several edits in one call, applied as one change (one history entry); stops at the first refused edit and writes nothing |
| `connect_nets` | Connects many pins to named nets in one call, e.g. `{ "GND": ["R1.pin2", "C1.pin2"] }` |
| `route_track` | Draws one track of a net by hand from a pad, track or via of that net, as one change; refused when a point lands on another net's copper; the answer lists the copper violations it introduced |
| `add_via` / `remove_copper` | Places a via (net from the copper under it, size from the net class and the fabrication ring) or removes tracks and vias by id (or one segment of a track by `{ id, segment }`), each as one change |
| `fillet_tracks` / `straighten_tracks` | Rounds the square corners of tracks (by id, or every track) into short chords on an arc of the design rules' fillet radius, or puts rounded corners back, each as one change; a corner too close to other copper, a pad, a keepout or the board edge, or with legs too short, stays square and is counted |
| `copper_summary` | Per net: tracks, vias, length and unrouted connections, then copper violations by rule (at most 60 lines) |
| `board_summary` / `project_status` / `note_decision` / `set_project` | The board in about 60 lines (size, one line per part, longest connections with both pads' places, overlaps, edge, pours; `detail: "full"` for the rest); and the project memory `PROJECT.md` (Intent, Blocks, Decisions, Open) with each circuit's counts and last changes, a dated decision, or rewritten sections, each write one change |
| `render` | A PNG of the board or of one schematic page, drawn by the Studio's own code; `parts` zooms to some parts (needs the optional package `@napi-rs/canvas`) |
| `list_parts` / `part_info` | Shows the parts library and a part's data and checklist |
| `create_part` | Adds a part from a datasheet: pins, footprint string or footprint file, MPN, suppliers |
| `import_part` | Fetches one part by its LCSC number from EasyEDA into `parts/<id>/`, unverified, for personal, non-commercial use only (see [licences](docs/licences.md)) |
| `place_part` | Adds a library or built-in part to a circuit, with its import |
| `bom` / `export_package` | Bill of materials; folder with BOM, datasheets and part status |
| `recent_changes` | Recent changes by you and the agent, including undos |
| `undo_change` | Undoes one of the agent's own changes |

There is no unlock tool and no verify tool on purpose.

## CLI

```text
copperflow mcp                              start the MCP server on stdio
copperflow studio [--port n]                open the visual editor at http://127.0.0.1:4777
copperflow skill [--global]                 copy the copperflow skills into .claude/skills
copperflow summary <file>                   print a circuit summary
copperflow check <file>                     list the errors and warnings of copperflow's own rule checks
copperflow lock <file> <part...>            lock parts so the agent cannot change them
copperflow unlock <file> <part...>          unlock parts
copperflow mark <file> <text> [--pcb x,y | --sch x,y]
                                            leave a note for the agent
copperflow unmark <file> <id>               remove a note
copperflow parts                            list the parts library
copperflow parts build                      regenerate part components after editing part.yaml
copperflow parts verify <id> --by <name> --against <datasheet, page>
                                            mark a part as checked against its datasheet
copperflow parts import <C-number> [--id <id>] [--replace]
                                            fetch a part by its LCSC number from EasyEDA into parts/,
                                            not verified (needs the internet; see docs/licences.md)
copperflow place <file> <part> <name> [key=value ...]
                                            add a library or built-in part to a circuit
copperflow bom <file> [--csv]               print the bill of materials
copperflow package <file> [--out dir]
                                            write BOM, datasheets and part status to a folder
copperflow render <file> [--view pcb|schematic] [--page <name>] [--parts U1,C3] [--width n] [--out file.png]
                                            draw the board or a schematic page to a PNG, as the Studio shows it
copperflow board <file> --dxf <path> [--layer <name>] [--units mm|inch] [--origin keep] [--replace]
                                            set the board's outline, holes and keepouts from a DXF drawing
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
