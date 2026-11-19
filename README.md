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

> **Status: 0.4, early.** The core, the MCP server, the CLI, the visual editor, the parts library,
> placement, routing and the fabrication export work. Expect rough edges; see [docs/design.md](docs/design.md).

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

Without installing, the same server starts through npx: give `npx -y copperflow mcp` wherever a
client asks for the command. The first start takes about a quarter of a minute while npm fetches
the package.

An agent that can run commands can set copperflow up for itself: the steps are at
<https://copperflow.kurpeeren.com/llms.txt> as plain text. Most programs load their MCP servers
when a session starts, so the tools appear in the next session, not in the one that added them.

`copperflow connect claude-desktop` adds the server to Claude Desktop's config (it keeps every other
setting and leaves a backup of the original); `copperflow connect claude-code` prints the line for
Claude Code.

While a tool runs long (autoroute, autoplace, the exports, a 3D picture) the server sends MCP
progress notifications, so a client that shows them says "Routing: 3 of 8 connections". When the
Studio is open on the same project, every tool call also shows in a strip under its toolbar, and
`open_studio` brings that window to the front instead of opening another.

### Desktop app (Windows)

`copperflow-Setup.exe` from the [latest release](https://github.com/kurpeeren/copperflow/releases/latest)
installs copperflow for the current user, with its own runtime: no Node.js or npm needed. It opens to a
start screen (recent projects, open a folder, a new project) and then the Studio of that folder; File →
Projects… goes back. The same program is the MCP server: the start screen's **Connect** writes it into
Claude Desktop, and **Copy the command** gives the line for Claude Code. An agent works headless; when
the window has its project open, the agent's changes and what it is doing appear there as it goes.

The installer is not signed yet, so Windows shows "Windows protected your PC" the first time: choose
More info, then Run anyway. The release carries the installer's SHA-256 beside it. To build it from
source: `npm run build`, then in `desktop/`, `npm ci` and `npm run dist` (the installer is in
`desktop/out/`).

### Open the visual editor

```bash
copperflow studio --root examples/usb-c-ldo
```

Then open the address it prints. The address carries a key for this session, so other web
pages and other programs on your computer cannot use the editor's API.

A connected agent opens it for you: ask it to open copperflow and it calls `open_studio`, which
starts the editor for the project if none runs and opens it in your browser. An editor started
that way stops by itself an hour after the last tab closes; `copperflow studio stop` stops it at once.

The schematic and the PCB are drawn from the design copperflow's engine builds, with
copperflow's own footprints and schematic symbols. The PCB shows the ratsnest, a straight line
for each connection still to be made, until it is routed by hand or by the router. A third tab,
3D, shows the board as it will be made with its parts on it (see [Pictures and 3D](#beyond-drawing)).

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
[editable-subset.md](skills/copperflow/references/editable-subset.md#footprint-strings), and
`copperflow packages [words]` browses the standard packages by name, with pads and size), or
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

## Beyond drawing

**Checking a part against its datasheet.** Verify on a library part opens a screen in the Studio: the
footprint drawn with its dimensions, each pin as a row to tick, and the recorded datasheet beside them.
The part can be marked verified only when every item is ticked, and only a person can do it.

**What a change did.** `copperflow history <id>` (the agent's `recent_changes { id }`) says what one
change did: parts added, removed and moved, nets and copper; `--since <id>` covers everything after
it. `copperflow render <file> --change <id>` draws it on the board, and each row of the Studio's Log
has Show.

**Ready to order.** `copperflow bom` ends with whether the board is ready to order bare and ready for
assembly, and names the lines with no supplier part number. No price or stock is checked.

**Pin map for firmware.** `copperflow pins <file>` lists which net is on each pin of the chips and
connectors, as a table, CSV or a C header (`--format c`); `copperflow package` writes them too.

**Fabrication files.** `copperflow export <file>` writes the Gerbers, drills, pick-and-place file and
BOM for JLCPCB into `<name>-fab/` and a zip, with `<name>.step` for a mechanical CAD program and a
picture of each side of the board. A circuit with errors is refused.

**Pictures and 3D.** `copperflow render <file> --view board` draws the bare board as made: every
fabrication layer is drawn by itself, from the same data the Gerbers are written from, and they are
put together as mask, finish, print and holes, in the maker's usual colours (`--mask`, `--finish`,
`--silk`). `--view 3d` and the Studio's 3D tab lay that picture on the board and stand the parts on
it. `copperflow glb <file>` writes that same board and its parts as a GLB file, a 3D model a viewer, a
3D editor or a web page opens and turns; `copperflow step <file>` writes the STEP file alone. Both
write a board that is not finished too. `copperflow html <file>` (MCP `export_html`) writes the whole design as
one web page to hand to someone: every schematic page, the PCB view, the board as made top and bottom,
3D from three angles and the BOM as a table, with the fabrication zip, the GLB, the STEP file and the
BOM as CSV inside it as downloads. It opens from disk with no network; a design with errors is written
too, without the fabrication files, and says why. The parts are simple shapes, not their real models, in the 3D
view, the GLB file and the STEP file; a part's height comes from its `height` in `part.yaml`, else a
typical figure for its package, else 1 mm, and the view says which.

**Fast lines.** Net classes in `rules.yaml` take an impedance, a differential pair with its gap and
skew, a longest length and length-matched groups; the checks report a pair that runs apart or differs
in length, and `copperflow impedance` gives widths and gaps for the board's stack. The figures are
estimates, and the router does not route pairs together or tune lengths yet. See
[design-rules.md](skills/copperflow/references/design-rules.md).

**Simulation.** `copperflow simulate` (the agent's `simulate`) finds the DC operating point from ideal
sources and simple part models: no time, no frequency, no temperature, no tolerance, and chips are not
modelled. A sheet's card can hold cases ("at 24 V in, the output is between 3.0 and 3.5 V") that it
runs; `copperflow spice` writes the same circuit as a SPICE netlist for another simulator.

**A board from KiCad.** `copperflow import kicad board.kicad_pcb` (the agent's `import_board`, or
File, Import board in the Studio) makes a new circuit from a KiCad 6 or newer board: its outline,
parts, nets, tracks, vias and pours. The parts arrive as library parts, not verified.

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
| `import_board` | Sets the board's outline, mounting holes and keepouts from a DXF drawing in the project folder, as one change; a `.kicad_pcb` file makes a new circuit from a KiCad board |
| `autoroute` / `unroute` | Routes the unrouted connections (the whole board, some nets, some parts or one instance) and names each one it could not route with the reason; or removes the router's copper |
| `add_pour` / `remove_pour` / `add_hole` / `remove_hole` | A copper pour of a net on one layer, or a non-plated mounting hole, each as one change |
| `simulate` | The DC operating point of a circuit or a sheet: set nets to volts, close switches, energise relay coils; with a sheet and no values it runs the sheet's cases |
| `make_sheet` / `describe_sheet` | Moves parts into a sub-sheet with ports, and writes a sheet's card: what it does, its ports and its cases |
| `list_modules` / `module_info` / `use_module` / `save_module` | The shelf of modules and the libraries: read one, bring one into the project, save a described sheet |
| `export_fabrication` | Writes the fabrication files, the STEP model and the board's pictures; refused when the circuit has errors |
| `export_model` | Writes the board and its parts as one 3D model file, STEP for mechanical CAD or GLB for a 3D viewer; an unfinished board too |
| `export_html` | Writes the design as one web page (schematic, board, 3D, BOM, with the fabrication and model files inside) to hand to a person; opens offline |
| `attach_datasheet` / `guide` | Records the datasheet a part came from; and the copperflow skill's texts for an agent that has no skills |
| `edit_circuit` | Several edits in one call, applied as one change (one history entry); stops at the first refused edit and writes nothing |
| `connect_nets` | Connects many pins to named nets in one call, e.g. `{ "GND": ["R1.pin2", "C1.pin2"] }` |
| `route_track` | Draws one track of a net by hand from a pad, track or via of that net, as one change; refused when a point lands on another net's copper; the answer lists the copper violations it introduced |
| `add_via` / `remove_copper` | Places a via (net from the copper under it, size from the net class and the fabrication ring) or removes tracks and vias by id (or one segment of a track by `{ id, segment }`), each as one change |
| `fillet_tracks` / `straighten_tracks` | Rounds the square corners of tracks (by id, or every track) into short chords on an arc of the design rules' fillet radius, or puts rounded corners back, each as one change; a corner too close to other copper, a pad, a keepout or the board edge, or with legs too short, stays square and is counted |
| `copper_summary` | Per net: tracks, vias, length and unrouted connections, then copper violations by rule (at most 60 lines) |
| `board_summary` / `project_status` / `note_decision` / `set_project` | The board in about 60 lines (size, one line per part, longest connections with both pads' places, overlaps, edge, pours; `detail: "full"` for the rest); and the project memory `PROJECT.md` (Intent, Blocks, Decisions, Open) with each circuit's counts and last changes, a dated decision, or rewritten sections, each write one change |
| `open_studio` | Starts the Studio for the project if none runs, opens it in your browser and answers with the address |
| `render` | A PNG of the board or of one schematic page, drawn by the Studio's own code; `view: "board"` is the bare board as made: mask, finish, print and holes drawn from the fabrication layers, either side, in the maker's usual colours; `view: "3d"` is that board with its parts as simple shapes, at an angle; `change` or `since` draws what a change did; `parts` zooms to some parts (needs the optional package `@napi-rs/canvas`) |
| `list_parts` / `part_info` | Shows the parts library and a part's data and checklist |
| `create_part` | Adds a part from a datasheet: pins, footprint string or footprint file, MPN, suppliers |
| `import_part` | Fetches one part by its LCSC number from EasyEDA into `parts/<id>/`, unverified, for personal, non-commercial use only (see [licences](docs/licences.md)) |
| `place_part` | Adds a library or built-in part to a circuit, with its import |
| `bom` / `export_package` | Bill of materials, with whether the board is ready to order; folder with BOM, datasheets, part status and pin maps |
| `recent_changes` | Recent changes by you and the agent, including undos; `id` says what one change did, `since` everything after it |
| `undo_change` | Undoes one of the agent's own changes |

There is no unlock tool and no verify tool on purpose.

## CLI

```text
copperflow mcp                              start the MCP server on stdio
copperflow studio [--port n] [--idle-minutes n]
                                            open the visual editor at http://127.0.0.1:4777 (or a free port);
                                            with --idle-minutes it stops after n minutes with no tab open
copperflow studio stop                      stop the Studio of this folder
copperflow skill [--global]                 copy the copperflow skills into .claude/skills of this folder
                                            (or of your home folder), for agents that read skills
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
copperflow modules                          list the shelf of modules (COPPERFLOW_MODULES, default ~/.copperflow/modules)
copperflow modules verify <name> --by <name>
                                            mark a module (or <library>/<name>) as checked by you
copperflow modules remove <name>            take a module off the shelf
copperflow library                          list the libraries of modules: built in, git and folders
copperflow library add <name> <address or folder> [--ref <branch or tag>]
                                            add a library from git (https://, ssh:// or user@host:path)
                                            or a folder; its modules read NOT verified until you verify them
copperflow library update [name]            bring git libraries to the newest commit of their ref
copperflow library remove <name>            forget a library (a clone is deleted, a folder never)
copperflow packages [words...]              the standard packages with their footprint strings, pads and size
                                            (words narrow the list: soic, sot 5, sc70, crystal)
copperflow place <file> <part> <name> [key=value ...]
                                            add a library or built-in part to a circuit
copperflow bom <file> [--csv]               print the bill of materials
copperflow package <file> [--out dir]
                                            write BOM, datasheets, part status and pin maps to a folder
copperflow pins <file> [--part <name>] [--format md|csv|c]
                                            which net is on each pin of the library chips and connectors
copperflow export <file> [--out dir]        write the fabrication files for JLCPCB: Gerbers, drills,
                                            pick-and-place and BOM in <name>-fab/ and <name>-fab.zip
                                            beside the circuit (or in the project folder --out), with <name>.step
copperflow step <file> [--out file.step]   write the board and its parts (as boxes) as a STEP file for CAD,
                                            <name>.step beside the circuit
copperflow glb <file> [--out file.glb] [--mask black] [--finish hasl] [--silk black]
                                            write the board as made and its parts (as simple shapes) as a GLB
                                            file a 3D viewer turns, <name>.glb beside the circuit
copperflow html <file> [--out file.html] [--mask black] [--finish hasl] [--silk black]
                                            write the design as one web page with its files inside,
                                            <name>.html beside the circuit
copperflow render <file> [--view pcb|schematic|board|3d] [--page <name>] [--parts U1,C3] [--width n] [--out file.png]
    board: the bare board as made [--side bottom] [--mask black] [--finish hasl] [--silk black] [--background #rrggbb]
    3d: the board as made with its parts as simple shapes [--angle top|bottom|front|iso] and the same look options
                [--change <id> | --since <id>]
                                            draw the board or a schematic page to a PNG, as the Studio shows it
                                            (<name>-pcb.png or <name>-schematic-<page>.png beside the circuit)
copperflow simulate <file> --set V12=12 --set CTRL=3.3 [--sheet <name>] [--closed SW1,J2] [--coil K1] [--all]
                                            the DC operating point from ideal sources and simple models: no time,
                                            no frequency, no temperature, no tolerance; chips are not modelled.
                                            With --sheet and no --set it runs the sheet's cases
copperflow spice <file> [--sheet <name>] [--set net=volts ...] [--out file.cir]
                                            write the same circuit as a SPICE3 netlist for another simulator
copperflow board <file> --dxf <path> [--layer <name>] [--units mm|inch] [--origin keep] [--replace]
                                            set the board's outline, holes and keepouts from a DXF drawing
copperflow import kicad <board.kicad_pcb> [--name <circuit name>] [--replace] [--origin keep]
                                            make a new circuit from a KiCad board: its outline, parts (as
                                            library parts, not verified), nets, tracks, vias and pours
copperflow impedance [--single 50] [--pair 90] [--gap 0.2] [--width 0.3]
                                            line widths and gaps for an impedance on the board's stack (rules.yaml);
                                            an estimate: the router does not route pairs together or tune lengths
copperflow history [--limit n]              list recent changes
copperflow history <id> | --since <id>      what one change did, or everything after it
copperflow undo [id]                        undo the newest change, or the given one
```

Every command accepts `--root <dir>` (default: the current directory).

## Libraries

A library is a folder of modules laid out as the shelf is: `modules/<Name>/` (or `<Name>/` at the top
when there is no `modules` folder), each holding `<Name>.sheet.tsx`, `parts/<id>/part.yaml` (and
`footprint.yaml`) and an optional `module.json`. copperflow comes with one, named `copperflow`; you
add your own:

```text
copperflow library add <name> <git address or folder> [--ref <branch or tag>]
copperflow library update [name]
copperflow library remove <name>
```

`copperflow library` lists them. The agent sees their modules as `<library>/<Name>` in
`list_modules`, `module_info` and `use_module`. A circuit file is code that runs when the board
builds, so a sheet from a library enters a project only when copperflow has proved it plain (part
imports, one function returning tags with literal values, nothing else), and its parts come as data,
their component files written by copperflow. A library module reads NOT verified until you run
`copperflow modules verify <library>/<Name> --by <name>`.

## Roadmap

- **0.2** (done) Visual editor in the browser: drag, rotate, lock, delete and reconnect wires, marks.
- **0.3** (done) Parts library (one folder per part) and datasheet-to-part import; BOM and datasheet package.
- **0.4** (done) Placement, routing, pours and the fabrication export; sheets, modules and libraries; part
  verification on screen, the change view, the order report, pin maps, STEP and the 3D view, fast-line rules,
  DC simulation, KiCad board import and the board drawn as made.
- **Next** Routing pairs together and tuning lengths, time and frequency in the simulator, real part models in 3D.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). "copperflow" refers to this
project; the license does not grant rights to the name.

The visual editor bundles open-source packages (React, MIT). Their licences ship in
`dist/app/THIRD_PARTY_LICENSES.txt`.
