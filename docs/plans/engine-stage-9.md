# Engine stage 9: the part library

Design: `docs/engine-design.md` §4 (parts and footprints), `docs/next-steps.md` ("Part library options"). Everything a board needs now exists — placement, routing, pours, checks, fabrication — but every part beyond the built-in kinds must be written by hand as `parts/<id>/part.yaml` (the CAN module needed MCP2515 and TJA1050 written from memory and marked Unverified). This stage makes parts cheap to get, in three ways that a person and the agent both use: generated standard packages (licence-free, exact by IPC formulas), a part wizard in the Studio, and an importer that fetches a part by its LCSC number into the project as an Unverified part for the person to check.

## Global constraints

The repository's constraints hold (English; one-line commits without trailers; small tested modules; typecheck, test and build pass; `src/engine/` deterministic and offline; files as LF). No new runtime dependency. Licence rules: footprint generators are copperflow's own from the IPC-7351B formulas (no code from KiCad or other GPL tools); the importer fetches part data only on the person's request, on their machine, into their project — nothing fetched is bundled with copperflow, and the importer's source states the data's origin and terms in `docs/licences.md` after Task 2 checks them; the import always produces an **Unverified** part with its `verification.md`, because only a person verifies library parts.

## Decisions

- **Generated packages.** New families in `src/engine/footprints/` by the IPC-7351B nominal formulas: `qfn<N>_<body>x<body>_p<pitch>` (with optional `_ep<size>` exposed pad), `dfn<N>…`, `qfp<N>_<body>x<body>_p<pitch>` (and `lqfp`/`tqfp` as aliases), `bga<N>_<body>x<body>_p<pitch>` (full grid, optional `_rows<R>x<C>`), `sod123`, `sod323`, `sma`, `smb`, `smc`, `do214` (aliases), `dip<N>` (300 mil, optional `_w<mm>`), `to220`, `to92`, `sot223`, `sot89`, `hc49`, `hc49s`, `radial<d>x<pitch>` (electrolytics), `pinrow2x<N>` (two-row headers). Each family: pads, courtyard, body, silkscreen with pin 1 mark, pin numbering per the package's convention (QFN/QFP counter-clockwise from pin 1 at the top left; BGA A1 at the top left with letters skipping I, O, Q, S, X, Z), documented in `docs/footprints.md` with one drawing per family.
- **Part wizard (Studio).** Library → **New part…**: a dialog with id, title, manufacturer, MPN, package (a footprint string with a live preview drawn from the generator, or "footprint file"), a pin table (number, name, type) that can be pasted from a datasheet's table (tab/comma separated, with "1 VDD power_in" lines), supplier numbers, datasheet URL; it writes `parts/<id>/part.yaml` (+ `footprint.yaml` when drawn by hand later), runs `parts build`, and opens `verification.md`. The agent gets the same as `create_part { id, title, package, pins, … }`.
- **Importer.** `copperflow parts import C9657` (CLI), `import_part { lcsc }` (MCP), Library → **Import by LCSC number…** (Studio): fetches the part's symbol, footprint and attributes from the public EasyEDA/LCSC part endpoints, converts the footprint to `footprint.yaml` (pads with shapes, drills, slots; the courtyard from the bounds; silkscreen lines and arcs; the body), the pins to `part.yaml` (names from the symbol, types `passive` unless the symbol says power/ground), the MPN, manufacturer and LCSC number, and writes the folder with `verification.md` listing every pin and the footprint for the person to check. Offline the commands say so and write nothing. Task 2 reads the source's terms of use first and records in `docs/licences.md` what may be done with the data; if the terms forbid even per-user conversion, the importer is not written and the plan says what replaces it (the wizard with a datasheet).
- **Status in the Studio.** Imported and wizard parts show the existing **Unverified** badge; `parts verify` works as today. `list_parts` and the Library panel show the origin (generated / written / imported from LCSC Cxxxx).

## Task 1: generated packages

- The families above in `src/engine/footprints/` (one module per family, shared IPC helpers in `ipc7351.ts`), the parser extended for the new strings, `docs/footprints.md`.
- Tests: each family's pad count, pitch, span and pin-1 position against the IPC nominal numbers for one real package each (e.g. QFN-32 5×5 0.5, LQFP-64 10×10 0.5, BGA-256 17×17 1.0, DIP-8, SOT-223, TO-220, HC49S); courtyards enclose pads; silkscreen clear of pads; determinism; the BGA letter sequence.

## Task 2: the importer

- `src/library/import-lcsc.ts` (fetch and convert; the EasyEDA footprint and symbol document formats to `footprint.yaml` and `part.yaml`; units mil → mm; pad shapes rect/oval/circle/polygon → the nearest supported shape with a note when approximated), the CLI, the MCP tool and the Studio dialog; `docs/licences.md` with the terms outcome.
- Tests: conversion from recorded JSON fixtures (three real parts: an SOIC-8, a QFN with an exposed pad, a through-hole connector) — never a live network call in tests; offline behaviour; the written files build and `parts build` accepts them; the Unverified badge.

## Task 3: the part wizard

- Library → New part… dialog, the pin-table paste parser (pure module), the footprint preview, `create_part` MCP tool; writes through the core (one history entry; `parts build`).
- Tests: the paste parser on three datasheet table styles, the written yaml, the preview's pads from the generator, the tool shape.

## Task 4: proof (controller)

Import the MCP2515 (C9657) and the TJA1050 (C6271) by LCSC number into the check copy, compare with the hand-written parts (pins and footprint), create a crystal with the wizard, build the CAN module from the imported parts, route, check, export.
