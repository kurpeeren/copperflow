# Engine stage 6: pages, sub-sheets and reuse

Asked by the maintainer (2026-11-10): "the schematic should be able to be sheet by sheet, or like sub-sheets", and "once a sub-sheet is designed it would be good to use it again and again on the upper sheet". EasyEDA Pro has multi-page schematics and reusable modules; KiCad has hierarchical sheets with per-instance annotation. This stage gives copperflow both, in the engine first (the file format and the flattening), then in the Studio and the agent's tools. The router (stage 5) works on the flattened board and is not affected; it may run before or after this stage.

Facts today: a project root holds several `*.circuit.tsx` files, each a separate circuit with its own board and its own Schematic and PCB tabs; one circuit's schematic is one sheet; parts and traces are written flat; nets are global to the circuit; `new_circuit` writes one flat file.

## Global constraints

The repository's constraints hold (English; one-line commits without trailers; no new dependencies; small tested modules; typecheck, test and build pass; `src/engine/` deterministic; nothing a person placed is moved by the engine; the core keeps one history entry per change, locks and the file-match rule for undo). Every file the Studio edits stays a readable TSX file a person can write by hand.

## Decisions

- **Pages.** One circuit's schematic may be split into pages: `<page name="Power">…</page>` wraps parts and traces inside the circuit; parts outside any page are on the first page ("Main"). Pages are drawing only: nets are still the circuit's, so a net label on one page joins the same label on another (as KiCad's global labels and EasyEDA's net labels across pages). Each page is a Schematic tab; the PCB is one.
- **Sub-sheets are files.** A reusable block is `<name>.sheet.tsx`, exporting a default function component whose body returns `<sheet>` with parts, traces, drawings and `<port name="VIN" />` elements; a port marks a local net as a connection point. The parent instantiates it as `<PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3", GND: "GND" }} schX={…} schY={…} />` (the import is an ordinary TSX import). The same file may be instantiated any number of times, and a sub-sheet may contain sub-sheets.
- **Instance annotation by base.** Inside a sub-sheet, parts carry their local designators (R1, C1). In the flattened design, each instance adds its `base` to every designator's number: PS1 with base 100 has R101 and C101, PS2 with base 200 has R201. Bases default to 100, 200, … in the parent's instance order, and may be set (`base={300}`); a clash with a flat part or another instance is an error. Local designators therefore never change when an instance is added, so nothing is renumbered.
- **Nets are local unless exported or global.** A net inside an instance is `PS1/NAME` in the flattened design, except a port's net, which is the parent net it is connected to, and a net under a power or ground flag, which is global (as EasyEDA and KiCad power symbols). An unconnected port is a `warning`; a connection to a port the sheet has not is an `error` naming the sheet's ports.
- **Placement travels with the instance.** Parts inside a sub-sheet may carry `pcbX`/`pcbY`/`schX`/`schY` relative to the instance; the parent instance's own `pcbX`/`pcbY`/`pcbRotation` place the block. A locked instance locks all its parts. The PCB "Replicate layout" command copies the relative placement and the copper of one instance to the others of the same sheet.
- **The sheet symbol is edited like a chip.** Asked by the maintainer (2026-11-10): the sub-circuit's symbol on the parent page must be editable "like a controller: the pins' positions, names". A port carries its place on the symbol in the sheet file — `<port name="VIN" side="left" order={1} />` (sides left/right/top/bottom, order along the side; defaults: inputs and power left, outputs right, ground bottom, in source order) — and the sheet's symbol size `<sheet width={6} height={4}>` (default from the port count). The Studio drags a port along the symbol's edge or to another side and writes `side`/`order`; the symbol's size is dragged at its corner. These are the sheet's, so every instance shows the same symbol; the instance's own props are its position, rotation, connections and base.
- **Buses cross the boundary.** A `<port name="DATA" bus />` is a bus port: inside the sheet it is the bus `DATA` with its members (the sheet's `<bus>`), outside it connects to a parent bus with the same member names (a member missing on one side is an `error` naming it). Bus ports are drawn as bus pins (the bus width and colour, a hollow pin) so they differ from net ports at a glance. "Make sub-sheet from the selection" turns a bus crossing the boundary into a bus port automatically.
- **Edits land in the file that owns the thing.** Editing a part inside a sub-sheet changes every instance (it is the sheet's part); the Studio says so in Properties ("In PowerStage, used 2 times"). Per-instance properties are the instance's props on the parent (`connections`, `base`, positions, lock).

## Task 1: pages

- Engine: `<page>` in the model and the evaluator; each part and trace knows its page; `src/engine/schematic.ts` lays out each page on its own origin; the design carries `pages: [{ name, parts, wires, labels, drawings }]`. The placement and the router (AI co-design round 1) work per page. A net label with the same name on two pages is one net (already true; add the test).
- Core: `addPart`/`place_part` take `page`; a new `movePartToPage` edit moves a part (and its hand-drawn wires) between pages; `new_circuit` accepts `pages`.
- Studio: a Schematic tab per page named "index — Power"; the Project Design tree lists pages under the circuit; Page → Add page, Rename, Delete (refused while it has parts); the page tabs follow EasyEDA's tab strip.
- Tests: the model and the layout per page; the edit; the cross-page net; the tabs' data.

## Task 2: sub-sheets in the engine

- Evaluator and elaboration: `*.sheet.tsx` files are evaluated as components; an instance is flattened with the base rule, the net rule and the position rule above; diagnostics for base clashes, unknown and unconnected ports, and a sheet that imports itself.
- The design keeps the hierarchy for the Studio and the tools: each flattened part knows its instance path (`PS1`) and its local designator; each instance knows its sheet file, base, connections and ports with their nets.
- `circuit_summary` shows instances compactly (`PS1 PowerStage base 100: VIN=VBUS VOUT=V3_3 GND=GND, 4 parts`), and the compact part lines use the flattened designators.
- Tests: two instances of one sheet build with distinct designators and separate local nets; ports join the parent nets; a power flag inside is global; each diagnostic; determinism; the summary.

## Task 3: sub-sheets in the Studio

- The parent page shows an instance as a sheet symbol: a box with the instance name, the sheet name and its ports as pins on the sides and in the order the ports say (bus ports as bus pins; the pins route like a part's, a bus pin like a bus), selectable, movable, rotatable, lockable, with Properties for `connections` and `base`; double click (and the Project tree) opens the sheet file as its own Schematic tab showing the sheet's parts with their local designators and the ports as flags. Editing the symbol: a port pin is dragged along the edge or to another side (writes `side`/`order` in the sheet file, one history entry), the symbol's corner is dragged for its size, and a port's Properties edits its name (renaming the local net) and its bus flag.
- Engine (in this task): `side`, `order`, `bus` on `<port>` and `width`/`height` on `<sheet>` in the model, validated; bus ports joined by member names with the missing-member error; the sheet symbol's pin layout as pure data for the Studio.
- Edits inside a sheet tab go through the core against the sheet file (one history entry, undo by file match); Properties says how many instances the part is used in.
- The PCB shows the flattened board with the flattened designators; selecting a part shows its instance in Properties; Select → "Select the instance" selects all parts of `PS1`; "Replicate layout" as decided above, one history entry.
- Tests: the sheet symbol's pins and bounds; the edits' target file; selection by instance; the replicate edits.

## Task 4: make a sub-sheet from the selection

- Edit → "Make sub-sheet…" on the schematic: the selected parts and the wires among them move to a new `<name>.sheet.tsx`; every net that crosses the selection boundary becomes a port named after the net, and every bus that crosses it a bus port with the bus's members; an instance replaces the selection on the page, connected to those nets, with base 100 (or the next free); the parts' designators are renamed to local ones only when the user agrees (the dialog shows the mapping). One history entry touching two files.
- Tests: the boundary ports; the instance's connections; the designator mapping; undo restores both files.

## Task 5: the agent's tools

- `new_circuit` accepts `sheets: { PowerStage: { parts, nets, ports } }` and `instances: [{ sheet, name, connections, base? }]`, writing the sheet files beside the circuit; `edit_circuit` gains `add_instance`, `set_connections`, `move_to_page`; `check_circuit` and `circuit_summary` report by instance when asked (`filter: "PS1"`).
- INSTRUCTIONS: a model should put a repeated block in a sheet and instantiate it, instead of writing the parts twice.
- Tests: tool shapes; a two-instance circuit from one call builds with no errors; the filters.

## Task 6: browser check (controller)

On the check copy: a circuit with a Power page and a Main page; a `PowerStage` sheet used twice; the parent shows two sheet symbols; the PCB shows R101 and R201; the sheet tab edits the shared part and both instances change; Replicate layout copies the first instance's placement; `new_circuit` builds the same from one call.
