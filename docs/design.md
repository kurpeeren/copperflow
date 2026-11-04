# copperflow design

Status: living document. Version 0.1 is the first milestone described in "Milestones".

## Intent

copperflow is an open-source, local-first framework for designing circuits in code
while a human and an AI agent work on the same design.

- Circuits are written as TSX on top of [tscircuit](https://github.com/tscircuit/tscircuit).
  The source file is the single source of truth.
- The human edits visually (move, rotate, lock parts, delete and reconnect wires,
  draw marks such as "route this here"). Every visual edit becomes a minimal text
  edit in the source file.
- The AI agent works through an MCP server. Any MCP client can connect; Claude Code is
  the primary target. There is no chat inside copperflow.
- The AI applies changes directly. The human reviews and undoes what they do not want.
  The AI never touches locked parts.

## Goals

1. Two-way editing: code edits and visual edits change the same file without
   reformatting the rest of it.
2. Locks and marks: the human can protect parts and leave instructions that the AI reads.
3. Summary-first AI tools: the agent reads a compact summary instead of whole files,
   so large projects stay within its context.
4. A parts library where each part has its own folder (data, notes, datasheet, 3D model).
5. Project hierarchy for big designs: a map, blocks with interfaces, a change log.
6. Skills: design-rule knowledge packaged for AI agents.
7. Outputs: schematic, PCB, 3D, BOM, fabrication files (through tscircuit), datasheet package.

## Non-goals

- No embedded LLM, chat window or cloud account.
- No reimplementation of tscircuit's compiler, autorouter, footprint generator or viewers.
  copperflow depends on tscircuit packages; it does not fork them.
- No replacement for KiCad in high-speed professional design in the first versions.

## Anti-goals (failure even if it "works")

- The AI silently overwrites a human change or a locked part.
- A visual edit rewrites or reformats code the human wrote.
- The AI writes pad coordinates or footprints by hand instead of using generated footprints.
- An "ERC passed" result is presented as proof that a circuit is correct.

## Constraints

- License: Apache 2.0. Dependencies must be permissively licensed (MIT, ISC, Apache, BSD).
  GPL tools (KiCad, Falstad) may be used only as external programs, never embedded.
- Runs locally on Windows, macOS and Linux with Node.js 22 or newer.
- tscircuit is at 0.0.x and changes daily, so its versions are pinned.

## How it works

### The editable subset

Like Remotion Studio, copperflow only writes back to code it can understand statically.
A part is editable when:

- it is a JSX element with a string-literal `name` prop (`<resistor name="R1" ... />`),
- it is not inside a `.map()` or another callback,
- it has no spread props (`{...props}`).

A prop of an editable part is editable when its value is a literal: a string, a number
(including negative numbers) or a boolean, or when the prop is absent. Expressions such as
`pcbX={x + 2}` are shown as read-only. Traces are editable when `from` and `to` are string
literals.

Everything else still works; it is simply read-only in the editor and in the AI tools,
and the summary says why.

### Locks and marks (annotations)

Locks and marks are not circuit content, so they live in a sidecar file next to each
circuit: `board.circuit.tsx` has `board.circuit.annotations.json`. This file is committed.

- A lock stores the part name and a snapshot of its literal props.
- Only humans lock and unlock (CLI now, editor later). The MCP server has no unlock tool.
- MCP edit tools refuse to change or remove a locked part, to remove a container that holds
  a locked part, and to remove a trace that touches a locked part (directly or as a side
  effect of removing a part). Adding a new trace to a locked part is allowed.
- Locks are looked up from the file's real path on disk, so a differently spelled path
  (case, symlink) cannot skip them. Only `*.circuit.tsx` files inside the project can be edited.
- Because an agent could also edit the file directly with its own file tools, every summary
  and every edit result includes a lock check: any locked part that is missing or whose
  props differ from the snapshot is reported as a violation.
- A mark is a short text, optionally with a position on the PCB or schematic view.
  The AI reads marks in the summary.

### History and undo

Every edit made through copperflow is recorded in `.copperflow/history/` (not committed)
with its author (`ai` or `human`), a one-line summary, and the file content before and after.
One AI tool call is one undo step. Undo restores the previous content only if the file has
not changed since and the undo would not change a part that is locked now; otherwise it
refuses and says so. The agent can undo only its own changes. Edits in one project run one
at a time, the history entry is written before the file, and files are replaced atomically.
History entries are validated when read, so a damaged or crafted entry is reported, not trusted.
The history doubles as the change log the agent reads, so it does not repeat a change the
human undid.

### MCP tools (0.1)

| Tool | Purpose |
|------|---------|
| `list_circuits` | circuit files in the project |
| `circuit_summary` | parts, props, traces, locks, marks, read-only reasons, lock violations |
| `set_props` | change literal props of a part (position, rotation, value, footprint) |
| `remove_part` | remove a part and the traces connected to it |
| `add_trace` | add a trace between two selectors |
| `remove_trace` | remove a trace |
| `check_circuit` | build with the tscircuit CLI and report errors and warnings from the circuit JSON |
| `recent_changes` | recent history entries, including undos |
| `undo_change` | undo one of the agent's own changes |

All file arguments are resolved inside the project root; paths outside it are rejected.
Every edit is re-parsed before it is written; an edit that would produce invalid code is
rejected.

### Studio (0.2)

`copperflow studio` starts a local web server and opens a browser editor for the project.

- The server builds the selected circuit with the tscircuit CLI (about 8 s for the example
  board) and serves the circuit JSON. It watches circuit and annotation files, so changes made
  by the agent or in a code editor appear in the browser, and rebuilds after each change.
- The PCB view is copperflow's own canvas with its own renderer (`studio/src/pcb/render.ts`):
  board, pads of every shape, plated holes, holes, vias, traces on both layers, silkscreen
  paths, lines, rectangles, circles and text, courtyards and fabrication notes, in layer order
  and copperflow's palette. Element types it does not draw yet go to tscircuit's MIT drawer
  (`circuit-to-canvas`) under the copper, and the status line names them. Hovering a pad
  highlights its whole net and dims the rest; layers can be shown or hidden. copperflow owns
  the camera (pan, zoom to the cursor, fit), the grid (dots on the minor grid, lines on the
  major grid), selection and hover, dragging that snaps the part's centre to 0.1, 0.5 or 1 mm,
  lock badges, notes drawn as pins, and keys (R rotates, Delete removes, F fits). A dragged part
  is drawn by the same renderer with an offset, so it looks exactly like itself while it moves. Dropping it becomes a
  `setProps` edit of `pcbX`/`pcbY`: the drag distance is added to the literal values, or the
  new centre is written when the part had no position.
- No vendor labels are shown on screen. The licences of every bundled package ship in
  `dist/app/THIRD_PARTY_LICENSES.txt`, generated at build time.
- The schematic view is copperflow's own canvas and renderer too (`studio/src/pcb/schematic-render.ts`).
  Passive parts are drawn from the symbol shapes in `schematic-symbols` with their designator and
  value; chips are boxes with numbered, labelled pins; wires, junctions, net labels, power rails
  and the circuit's own text and graphics are drawn in copperflow's palette. Element types it does
  not draw yet are named in the status line. The same camera, grid, snapping, selection, lock
  badges, notes and keys as the PCB apply. Dragging a symbol writes `schX`/`schY`; R writes
  `schRotation`. In wiring mode (W) every pin is marked, the pin under the pointer is
  highlighted, and clicking near two pins adds a trace between them; the nearest pin within
  12 px is used.
- A side panel lists parts (lock, rotate by 90°, remove), traces (remove), marks (add at the
  selected part or at a box drawn on the PCB, remove), the build report and the history with
  undo.
- The Library tab places library or built-in parts with the next free designator; built-in
  parts get starting values tscircuit needs (a capacitor gets 100nF). The inspector shows a
  library part's data, datasheet and checklist, and a person can mark it verified by typing the
  part id. With nothing selected, the inspector shows the BOM and exports the datasheet package.
- An agent that starts the Studio itself sees the session key in its terminal; the Studio's
  verify action is meant for people, like `copperflow parts verify`.
- Every change goes through the same core as the agent's tools, with author `human`: locks,
  history and undo behave the same way.
- Security: the server listens on 127.0.0.1 only, accepts only `localhost`/`127.0.0.1` Host
  headers, rejects cross-origin requests and requires a random per-session token in a header.
  The token is never served by the server: the CLI prints it in the URL fragment, which
  browsers do not send, so neither web pages nor other local programs can obtain it. Pages
  carry a strict Content-Security-Policy (no external connections), event streams and
  connections are capped, and unexpected errors are reported without file paths.
- The browser app is built with Vite and shipped prebuilt in the npm package; the viewers are
  bundled into it, so they are not runtime dependencies.

### Project hierarchy (planned)

```
project/
  PROJECT.md          map: what the board does, blocks and the nets between them
  rules.yaml          project rules, e.g. single layer, 0 ohm jumpers allowed
  blocks/<block>/
    BLOCK.md          purpose, decisions and why
    interface.yaml    nets the block exposes
    _summary.md       generated by copperflow, never edited by hand
  parts/<part>/       part.yaml, notes.md, datasheet.pdf, model.step, verification.md
  log/                human-readable change log
```

The agent starts from `PROJECT.md`, reads only the block it works on, and reads only the
interfaces of neighbouring blocks. Global nets (ground, supplies) are listed separately.
Notes are plain Markdown with `[[links]]`, so the folder also opens in Obsidian.

### Parts library (0.3)

One folder per part under `parts/` in the project:

```
parts/AP2112K-3.3/
  part.yaml          the source of truth: title, manufacturer, MPN, footprint, pins, suppliers
  AP2112K_3_3.tsx    generated tscircuit component; never edited by hand
  verification.md    checklist of what was checked against the datasheet, and where
  datasheet.pdf      optional local copy
```

- `part.yaml` lists pins by number with a name and an electrical type (`power_in`,
  `power_out`, `ground`, `input`, `output`, `bidirectional`, `passive`, `no_connect`).
  The types become tscircuit pin attributes, so the build can warn about unpowered parts.
- The footprint is a tscircuit footprint string such as `sot23_5` or `soic8_p1.27mm`.
  Nobody writes pad coordinates; the footprint generator draws the pads.
- The agent creates a part by reading the datasheet itself and calling `create_part`. The
  part starts as *not verified*. Only a human marks it verified (`copperflow parts verify`),
  after checking the items in `verification.md`. The agent has no verify tool.
- `place_part` adds a part to a circuit: a library part (with its import added) or a
  built-in tscircuit part such as a resistor. Passive parts need no library entry.
- The BOM groups parts by kind, value, footprint and manufacturer part number, and fills in
  supplier part numbers from the last build when the library does not give them.
- `copperflow package` writes a folder with the BOM (CSV and Markdown), the local datasheets
  and a list of every part with its datasheet link and verification status.

## Milestones

- **0.1** (this release): source model with the editable subset, edits, locks and marks,
  history and undo, MCP server, CLI, a workflow skill, an example board, CI.
- **0.2** (done): browser Studio built on tscircuit viewers; drag, rotate, lock, delete and
  reconnect wires, draw marks; all written back through the 0.1 core.
- **0.3** (done): parts library format and datasheet-to-part pipeline; BOM and datasheet package.
- **0.4**: project hierarchy (blocks, interfaces, generated summaries), `rules.yaml` checks.
- Later: redesign a PCB from a photo, design-rule skills library, simulation.

## Decisions made by the maintainer

- Apache 2.0 license; tscircuit as a dependency, not a fork.
- Local program; AI connects over MCP; no chat inside the program.
- The AI applies changes directly; the human undoes.
- Vault-like hierarchy for large projects.
- Everything in the repository is in English.

## Calls made during design (open to change)

- Source format is TSX with an editable subset (instead of a separate data format), so that
  hand-written code, AI edits and visual edits all meet in one file.
- Locks and marks live in a sidecar file, not as props, so tscircuit never sees unknown props.
- One AI tool call is one undo step; the agent may undo only its own changes.
- Locks protect a part's props and existence and the existing traces that touch it,
  not new connections to it.
- Removing a part also removes its traces, but refuses when one of them reaches a locked part.
- Undo, by the agent or the human, refuses to change a locked part; unlock it first.
- copperflow stays a single npm package: the Studio's browser code lives in `studio/` and is
  built into `dist/studio`.
- Studio drags write `pcbX`/`pcbY` by adding the drag distance to the existing literals, so
  parts inside offset groups move correctly.
