# Perfboard and stripboard

A quick build on a board of 2.54 mm holes instead of a made PCB. **Perfboard** has an isolated pad round each hole;
connections are runs of solder from hole to hole on the bottom, and wire links on the top. **Stripboard** has copper
strips joining the holes along each row; the strips are cut between nets and links join one strip to another.

## The board

```tsx
<board kind="perfboard" columns={24} rows={18} />
<board kind="stripboard" columns={30} rows={20} />                    // strips along the rows
<board kind="stripboard" columns={30} rows={20} strips="columns" />   // strips down the columns
```

Holes are named by row letter (A at the top) and column number (1 at the left): `C7`. The size is in holes; `width`,
`height` and `outline` do not apply. There are no pours, no tracks and no vias.

- New circuit: `new_circuit` `{ board: { kind: "stripboard" } }` (with `width`/`height` in mm it is rounded up to whole
  holes; without, the board is fitted round the parts).
- An existing board: `fit_board` `{ file, kind: "perfboard" }` turns it into one, moves the placed parts onto holes and
  fits the board round them; `kind: "pcb"` turns it back. `fit_board` `{ file }` fits a hole board in whole holes with
  one free hole all round.

## Parts

Only through-hole parts with pins on the 2.54 mm grid go on: `axial6.3x10.16` resistors and diodes, `to92`, `led5mm`,
`dip8`, `pinrow…` headers, `screw<N>` terminals at 5.08 mm, modules on pin headers. `check_circuit` refuses:

- `proto-smd`: a part with surface pads; give it a through-hole footprint.
- `proto-off-grid`: pins not a whole number of 2.54 mm apart (a 5.0 or 3.5 mm terminal block, many relays), or a part
  between holes. A lead may bend 0.25 mm.
- `proto-outside`, `proto-hole-shared`: a pin past the holes, two pins in one hole.

`autoplace` puts the parts it places onto free holes at a quarter turn. On stripboard it turns a part so its pins lie on
different strips: a resistor across the strips, not along one.

## Routing

`autoroute` on such a board joins the pins along the holes only, one net at a time, as one change:

- perfboard: solder runs (`s1`, `s2`, …) between neighbouring holes, and a link where a run would cross another net;
- stripboard: the strips carry each net, links (`w1`, …) jump across strips, and a cut (`x1`, …) is made wherever a
  strip would join two nets: drilled at a free hole, or with a knife between two neighbouring holes.

A link runs straight along a row or column, never over a leg or another link. The answer counts runs, links and cuts
and names each connection it could not join (move parts apart, or turn them across the strips, and run it again).
`remove_copper` `{ file, all: true }` or `{ nets }` takes the router's runs, links and cuts back.

The records are lines of the layout file, editable by hand:

```json
{"t":"solder","id":"s1","net":"GND","holes":["C3","C4","D4"],"locked":false,"by":"router"}
{"t":"link","id":"w1","net":"V24","from":"C3","to":"H3","locked":false,"by":"router"}
{"t":"cut","id":"x1","at":"C7","locked":false,"by":"router"}
{"t":"cut","id":"x2","between":["E4","E5"],"locked":false,"by":"router"}
```

## Checks

- `proto-open` (warning): a net in pieces not joined yet.
- `proto-short`: two nets on one strip or joined by solder or a link; the message says which strip to cut.
- `proto-cut-splits`: a cut that parts a net nothing else joins. `proto-cut`: a cut in a pin's hole, or between holes
  that are not neighbours on one strip.
- `proto-link`, `proto-solder`: a link that is not straight or runs over a leg or another link; a solder step that is
  not to a neighbouring hole.
- `proto-record` (warning): a cut on perfboard, or a record whose net is not the net of the pins it joins.

## To build from

- `render` `{ file, view: "board", side: "top" }`: the parts and the links; `side: "bottom"`: the strips and cuts or the
  pads and solder, seen from below (left and right swapped), every cut marked with a red cross.
- `export` `{ file, as: "build" }`: `<name>-build.md` beside the circuit with each part's holes, the cut list, the link
  list with lengths, the solder runs, what each strip carries, the build order, and both pictures.
