# Licences of third-party packages

copperflow is licensed under the Apache License 2.0 (see `LICENSE` and `NOTICE`). This page lists third-party packages
added for a specific purpose, with the licence read from the package's own licence file when it was added.

## Runtime (shipped)

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| `clipper-lib` | 6.4.2 | Boost Software License 1.0 (the package has no licence file; the header of `clipper.js` states it: "Use, modification & distribution is subject to Boost Software License Ver 1", Copyright Angus Johnson 2010-2017, JavaScript translation by Timo). The bundled big-integer code is Tom Wu's JSBN, under its own BSD-style licence, as the same header notes. | Polygon booleans and offsets for the copper pour fill (`src/engine/pour/`). Used as a library; its code is not copied into copperflow. |

## Development only (tests; not shipped in `dist`)

| Package | Version | Licence | Why |
| --- | --- | --- | --- |
| `@tracespace/parser` | 5.0.0-alpha.0 | MIT (`LICENSE`, "Copyright (c) 2015-present, Michael Cousins and contributors") | Reads the written Gerber and Excellon files back in the fabrication tests, as a parser independent of copperflow's writers. Its bundle includes `moo` (BSD-3-Clause); its type dependencies `@types/unist` and `@types/moo` are MIT. |

No code is taken from these packages into copperflow's writers, and nothing from KiCad or any other GPL tool is used.

## Part data imported from LCSC / EasyEDA

`copperflow parts import <C-number>` (and the MCP tool `import_part`, and Studio's Library → Import by LCSC number…)
fetches one part's symbol, footprint and attributes from EasyEDA's public component endpoint
(`https://easyeda.com/api/products/<C-number>/components`, the one tools such as easyeda2kicad use) and converts it into
the person's own project. The terms below were read on 2026-11-11.

What the source says:

- **The notice inside every document.** Each symbol and footprint the endpoint returns carries a `license` field
  (Chinese and English). In short: the copyright and related rights in the JLCEDA/EasyEDA Official Library (device
  parameters, symbols, footprints, 3D models, related data) belong to JLCEDA/EasyEDA; it is addressed to any AI tool
  that cites, calls, retrieves, generates, reproduces, outputs or distributes all or part of the library; such use must
  prominently state the source as "JLCEDA/EasyEDA Official Library" with links to https://lceda.cn/ and
  https://easyeda.com, and must not delete, alter, hide or obscure that copyright and source information. Its
  commercial-use statement grants use in any commercial circuit design *when used in JLCEDA/EasyEDA*.
- **EasyEDA's Terms & Conditions** (easyeda.com/legal, operated by JiaLiChuang (HongKong) Co., Limited, effective
  2026-09-21): a personal, non-exclusive, revocable licence to use the service; content may be downloaded for
  personal, informational and non-commercial purposes; the content may not be modified, copied, distributed or made
  into derivative works; and robots, scrapers, scripts or other automated means may not be used to access or download
  content in bulk or systematically without written permission (nor for data mining or model training).
- **easyeda2kicad** (AGPL-3.0) states nothing about the data's terms; only that converted parts are not guaranteed
  correct. LCSC's own blog describes downloading EasyEDA footprints for use in KiCad, but grants nothing in writing.

What copperflow concludes and does:

- **Allowed, as copperflow does it:** one part at a time, only when the person asks for it by its C-number, fetched on
  their machine into their own project. That is not bulk or systematic access, and the notice explicitly anticipates
  tools that retrieve and output the library's parts provided the source is stated.
- **The source is stated and kept.** The written `part.yaml` names it (`origin: lcsc Cxxxx, imported <date>` and a
  description naming the JLCEDA/EasyEDA Official Library with both links), and the part folder gets `source.md` with
  the notice exactly as the document carried it. Nothing in copperflow removes either.
- **Nothing is redistributed by copperflow.** No fetched data is bundled, cached or shipped; copperflow's own tests use
  documents written for copperflow in EasyEDA's format (dimensions from the packages' standard drawings), not recorded
  copies of the library.
- **Not granted: commercial use outside EasyEDA, and modification.** The notice grants commercial use only inside
  JLCEDA/EasyEDA, and the Terms forbid derivative works; the conversion is a derivative made for the person's own use.
  The importer says so on every import and `source.md` repeats it: before using an imported part in a commercial
  design, the person draws the part from the datasheet (the part wizard) or obtains the right from JLCEDA/EasyEDA.
- **Always Unverified.** An imported part is written with its `verification.md`; only a person verifies it.

These are copperflow's reading of the terms, not legal advice; if JLCEDA/EasyEDA change them, the importer must be
checked again.
