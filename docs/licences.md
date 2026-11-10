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
