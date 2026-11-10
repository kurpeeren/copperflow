# Engine stage 7: fabrication outputs

Design: `docs/engine-design.md` §10 (fabrication outputs), §7 (copper and the layout file). Stages 4–6 gave hand copper, the router, pages and sub-sheets; a board can now be designed and routed, but it cannot leave copperflow: there is no Gerber, drill or pick-and-place writer (the old tscircuit exporters are gone). This stage makes a routed board manufacturable at JLCPCB (bare board and assembly), with the CAN module as the first board exported.

## Global constraints

The repository's constraints hold (English; one-line commits without trailers; small tested modules; typecheck, test and build pass; `src/engine/` deterministic; files as LF). One new **dev** dependency is allowed for the tests only: a permissively licensed (MIT/BSD/Apache) Gerber and Excellon parser used to read the written files back (the tracespace `gerber-parser`/`whats-that-gerber` family or an equivalent; check the licence file before adding; never a GPL package). Nothing from KiCad or other GPL tools. The writers are copperflow's own.

## Decisions

- **Formats.** Gerber X2 (RS-274X with X2 attributes: `.FileFunction`, `.FilePolarity`, `.Part`, `.GenerationSoftware` with copperflow's name, `.CreationDate`; `%FSLAX46Y46*%`, `%MOMM*%`, coordinates in mm with 6 decimals; `G36/G37` regions for pads and zones, `D01/D02/D03` with standard apertures `C`, `R`, `O` and `RoundRect` as macros), one file per copper layer (top, bottom, inner1, inner2 when the board has them), top/bottom solder mask (pad shapes grown by the fabrication profile's mask expansion, default 0.05 mm), top/bottom paste (SMD pads only, shrunk by the paste reduction, default 0), top/bottom silkscreen (outlines, designators, drawings), board outline (the `<board>` outline, 0.1 mm line), keepouts are not exported. Excellon drill files: plated (through pads and vias) and non-plated holes, `METRIC`, `FMAT,2`, tool list by diameter, slots as `G85` routes. Pick-and-place CSV in JLCPCB's columns (`Designator,Mid X,Mid Y,Layer,Rotation`), with a per-footprint-family rotation correction table (values stated in the rules content, default 0) and bottom-side mirroring as JLCPCB expects. BOM CSV in JLCPCB's columns (`Comment,Designator,Footprint,LCSC Part #`) from the existing BOM.
- **File names** follow JLCPCB's conventions (`<name>-F_Cu.gtl`, `-B_Cu.gbl`, `-F_Mask.gts`, `-B_Mask.gbs`, `-F_Paste.gtp`, `-B_Paste.gbp`, `-F_Silkscreen.gto`, `-B_Silkscreen.gbo`, `-Edge_Cuts.gm1`, `-PTH.drl`, `-NPTH.drl`, `-pick-and-place.csv`, `-bom.csv`), all inside `<name>-fab/` beside the circuit, plus `<name>-fab.zip`.
- **What is exported.** The built design: pads and holes from the footprints, copper from the layout file (every record, whoever made it), silkscreen from footprints and drawings, the outline from the board. Sub-sheet instances are flattened (their designators as on the board). A board with errors (not warnings) is refused; a board with unrouted connections is exported with a warning that names them.
- **Round trip.** Tests parse every written file back with the independent parser and compare against the model: pad count and positions per layer, track segments, via holes, outline length, drill counts; a second export of the same design is byte-identical (deterministic, no timestamps inside except the X2 `.CreationDate`, which is taken from an injectable clock).

## Task 1: Gerber writer

- `src/engine/fab/gerber.ts` (the file writer: header, apertures, flashes, draws, regions; pure, takes shapes in mm), `src/engine/fab/layers.ts` (the per-layer content from the built design: copper layers, mask, paste, silkscreen, outline), `src/engine/fab/names.ts`. The dev-dependency parser is added here with its licence noted in `docs/licences.md` (create it if missing).
- Tests: a one-pad board round-trips (aperture, flash position), a track with a 45° corner, a via on both copper layers, a rounded-rectangle pad as a macro, the mask expansion, the paste on SMD pads only, the outline as a closed path, byte-identical second run, X2 attributes present; the CAN fixture's top copper parsed back has 44 track segments and 12 via flashes after the router runs on it (route in the test with the stage 5 router).

## Task 2: drill, pick-and-place and BOM

- `src/engine/fab/excellon.ts` (plated and non-plated files, tool table, slots), `src/engine/fab/pick-and-place.ts` (JLCPCB columns, bottom mirroring, rotation table in `src/engine/rules/rotations.ts` with the profile), `src/engine/fab/bom-csv.ts` (from the existing BOM), `src/engine/fab/export.ts` (the whole set into the folder and the zip; the refusal on errors; the warning on unrouted).
- Tests: drill counts and diameters by tool, a slot, a bottom part's mirrored X and corrected rotation, the BOM rows, the folder listing and the zip's entries, the refusal and the warning.

## Task 3: CLI, MCP and Studio

- `copperflow export <file> [--out <dir>]` (CLI), `export_fabrication { file }` (MCP, compact answer: the folder, the file list, warnings), Export → **Fabrication files (JLCPCB)** in the Studio (writes beside the circuit and shows the folder in a note); the Export menu's existing items stay.
- INSTRUCTIONS and SKILL.md: after autoroute and a clean check_circuit, export_fabrication; a person uploads the zip.
- Tests: the CLI output and exit codes, the MCP shape, the Studio command.

## Task 4: proof (controller)

Export the CAN module (routed) from the Studio; open the Gerbers in an online viewer by hand (the maintainer) once; the zip holds 13 files; the pick-and-place lists 12 parts with U1 and U2 rotations as the footprint table says.
