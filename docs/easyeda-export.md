# EasyEDA Standard export

`copperflow easyeda <file>` (MCP `export` `as: "easyeda"`) writes the board as an EasyEDA Standard PCB document,
`<name>-easyeda.json` beside the circuit (or the project file `--out` / `out` names). EasyEDA Standard opens it as an
editable PCB with File > Open > EasyEDA... . A design with errors is written too: the file hands the board on, it is
not an order.

The encoder is `src/engine/fab/easyeda.ts` (the document), `easyeda-parts.ts` (a part as a footprint) and
`easyeda-shapes.ts` (one shape string per object); `easyeda-read.ts` reads a document back, for the tests and for
checking documents the editor itself saved.

## The format, as written

- A JSON object: `head` (`docType` "3", the origin `x`, `y`), `canvas` (the `CA~…` string), `shape` (one string per
  object, fields joined by `~`), `layers`, `objects`, `BBox`, `preference`, `DRCRULE` and `netColors`.
- Lengths are in 10 mil (1 unit = 0.254 mm) and y points down. The board's (0, 0) is put at the document point
  (4000, 3000) and the document's origin is set there, so EasyEDA shows copperflow's own coordinates in mm.
- Rotations are degrees counter-clockwise as seen, as in copperflow.
- Every hole size is written as a radius: a pad's and a via's hole, and a non-plated `HOLE`. EasyEDA's own documents
  read that way (a 7.62 mm terminal's 4 mm pad has a 3.937 unit hole radius, a 2 mm hole), though the format's
  public description calls the `HOLE` value a diameter.
- Net names are the net ids without the `net.` prefix (`net.GND` is `GND`). A `~` or `` ` `` in a name or text
  becomes `_`; two nets that would then share a name get `_2`, `_3`, so they never join.

## What is exported

| copperflow | EasyEDA shape |
|---|---|
| board outline | `TRACK` on the board outline layer (10), closed |
| part with a footprint | `LIB` at the part's place and turn, its layer field 1 (top) or 2 (bottom), its `package` the footprint's name; inside it: |
| ‑ pads | `PAD`: round as `ELLIPSE`, oval as `OVAL`, rectangle and rounded rectangle as `RECT` (with its corners); through pads on the multi layer (11) with the hole radius and, for a slot, its length and end points; surface pads on 1 or 2; the pad's net and number |
| ‑ silkscreen lines | `TRACK` on the top or bottom silk layer (3, 4) |
| ‑ body outline (fabrication) | `TRACK` on the top or bottom assembly layer (13, 14) |
| ‑ designator | `TEXT` kind `P`, where the Gerber legend prints it; hidden when the part hides it |
| ‑ value | `TEXT` kind `N`, hidden |
| tracks | `TRACK` on its copper layer (1, 2, inner 21, 22) with its net and width |
| vias | `VIA` with its diameter, hole radius and net |
| non-plated holes | `HOLE` |
| board texts (`<silkscreentext>`) | `TEXT` kind `L` on the silk layer, mirrored on the bottom |
| board drawings (`<boardgraphic>`) | each filled area a `SOLIDREGION` (holes joined in), each line a `TRACK`, on its silk, mask or copper layer |
| copper pours | `COPPERAREA` round the pour's outline (or the board's) on its layer and net, with its clearance, minimum width and thermal relief (`spoke`) or solid joint (`direct`) |
| default net class | `DRCRULE` track width, clearance and via sizes; the canvas's routing width |

Texts carry their strokes, drawn with copperflow's stroke font as the Gerber legend draws them, so they show as
copperflow prints them; EasyEDA draws them in its own font again when one is edited.

A 4-layer board's inner layers are switched on in the layer table.

## What is left out

- **The pours' fill.** A copper area is written with an empty fill. Rebuild the copper areas in EasyEDA (Shift+B) to fill
  them; the fill is EasyEDA's, not copperflow's.
- **Rounded pad corners.** EasyEDA Standard has no rounded rectangle pad; such a pad is written as a plain rectangle
  of the same size.
- **Keepouts**, **courtyards** and **the ratsnest** (EasyEDA draws its own from the nets).
- **Blind and buried vias** are written as through vias.
- **Parts without a footprint** (no pads to write), and copper on a layer the board lacks. The export's answer names
  each of these.
- **Library links.** The footprints are written as they are placed; they are not linked to EasyEDA's or LCSC's
  library, and carry no 3D model. Their attributes are `package`, `Contributor` and `Value`.
- **The schematic.** Only the PCB is written.

## Checking

The tests write each shape kind and read the documents back (`test/easyeda-shapes.test.ts`,
`test/easyeda-board.test.ts`): units and the y axis, every shape's string, an example board whose pads, tracks and
nets come back in place and in number. A PCB document saved by EasyEDA Standard 6.5 reads with the same reader, field
for field. What the editor makes of the file is checked by opening an exported example in EasyEDA Standard.
