# Next steps (2026-11-10)

## State
Router stage 5 Tasks 1–2 are on main: the CAN module routes 32/32 in under 1 s, the 200-part board 398/398 in 4.4 s, both with zero copper violations. Left in stage 5: cleanup (45°, fewer vias), the Studio Autoroute command with a worker and progress, the `autoroute` agent tool.

## Suggested schematic tools
- Net highlight on hover across pages and sub-sheets.
- Copy/paste with automatic designator renumbering.
- ERC panel with one-click jump to each issue.
- Template blocks (LDO, USB-C input, crystal + caps) placed as sub-sheets.

## Suggested PCB tools
- Copper pour (GND fill) with thermal reliefs.
- Differential pair routing (CANH/CANL, USB D+/D−).
- Length tuning for clocks.
- Gerber + drill + pick-and-place export, then a JLCPCB order package.
- 3D view of the board.

## Part library options
1. Own curated library (today): exact, but every part must be written and verified by a person.
2. Import from JLCPCB/LCSC (EasyEDA format part data by C-number): largest stock-linked set; needs a converter and a licence check per source.
3. KiCad libraries: very large, but CC-BY-SA with exception — usable as data with attribution, never their code.
4. Generator for standard packages (already: chip sizes, SOIC/SOP/TSSOP, SOT, pin rows), extended to QFN/QFP/BGA by IPC-7351 formulas.

Recommendation: keep 1 + 4 as the base and add 2 as an importer whose results stay "Unverified" until a person checks them.

## Footprint accuracy
- The `soic8` (dual) generator's inner pad edges sit 2.95 mm apart, against 3.85 mm in the IPC-7351B nominal pattern
  (SOIC127P600X175-8N): the heel term uses the full foot-length tolerance (0.41–1.27 mm), see
  `src/engine/footprints/ipc7351.ts` and `src/engine/footprints/dual.ts`. The same gull-wing row serves sop, tssop,
  sot23 and the QFP families. Pin those to published IPC-7351B patterns in tests, then correct the G term or the lead
  data.
- The pick-and-place rotation default of 0 for `qfn`, `dfn`, `qfp`, `lqfp` and `tqfp` is unverified; JLCPCB's preview
  (or an imported part of the same package) settles it.
- Follow-up: rotate imported footprints into copperflow's orientation on import, with a pick-and-place correction field
  in footprint.yaml so the assembly file stays right; the same field would cover hand-drawn footprint files.
