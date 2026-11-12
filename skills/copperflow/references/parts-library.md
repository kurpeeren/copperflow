# Creating library parts

Chips and connectors go into the project's parts library before they go into a circuit.
Passive parts (resistors, capacitors, LEDs, headers) are built in and need no entry.
(Without this skill installed, `guide { "topic": "parts-library" }` returns this page.)

## From a datasheet

1. Read the datasheet yourself. Find the package, the pin table and the ordering information.
   When no datasheet can be read (no link, offline, a scan you cannot read), say so to the
   person and ask for the datasheet; prefer that to writing pins from memory, which is often
   wrong (pins shifted by one). If they ask you to go on anyway, put `Pins NOT from a datasheet`
   in `description` and in PROJECT.md's Open.
2. Call `create_part` with:
   - `id`: the folder name, usually the part number, such as `AP2112K-3.3`.
   - `title`, `manufacturer`, `mpn` (the full orderable number, such as `AP2112K-3.3TRG1`).
   - `package`: a footprint string for the package, such as `sot23_5`, `soic8`,
     `qfn32_p0.5mm` or `tssop20`; copperflow makes the pads from it. The strings it knows are
     listed in [editable-subset.md](editable-subset.md). Use a footprint string whenever a family
     fits the package.
     When none fits, set `package` to `{ "file": "footprint.yaml" }` and pass `footprint_file`: transcribe
     every pad (number, shape, x, y, width, height, and a drill for through-hole pads) from the
     datasheet's recommended land pattern, name the page you took it from, and never estimate a
     coordinate. Each pad number must be a pin number; several pads may share one (a shell
     with two legs). Every pin except `no_connect` needs a pad. The part stays unverified
     until a human checks every pad against the datasheet. Without `footprint_file` a
     placeholder `footprint.yaml` (`placeholder: true`) is written: the schematic works, but each
     use on the board is a check error until the human draws the pads and deletes that line.
     Footprint files go into the pick-and-place file at their own orientation (the `file`
     family's correction is 0). Imported ones are already in JLCPCB's orientation. One drawn in
     copperflow's orientation (pin 1 top left, rows vertical) for a SOIC- or SOP-like package needs
     `fabrication.placementRotations.parts.<id>: 270` in `rules.yaml` (see
     [design-rules.md](design-rules.md)); tell the human to check it in JLCPCB's assembly preview.
   - `pins`: every pin by number, with the datasheet's name and an electrical type:
     `power_in`, `power_out`, `ground`, `input`, `output`, `bidirectional`, `passive` or
     `no_connect`. Pin names become selectors, so use letters, digits and `_` only
     (write `VCC_3V3`, not `+3.3V`).
     A pin may also name the schematic `side` it is drawn on (`left`, `right`, `top` or `bottom`);
     without it the electrical type decides.
     `pins` may also be the datasheet's pin table as text, one pin per line (`1 VIN power_in`,
     tab or comma separated too; a pin without a type is `passive`); a line with an unknown type
     is refused with its line number, so write the types out.
   - `suppliers` (for example `jlcpcb: C51118`) and `datasheet` when you know them: an object
     with only the keys `url` (an http or https link), `file` (a PDF file name in the part folder)
     and `title` (at most 200 characters), e.g. `{ "url": "https://example.com/ds.pdf", "title": "TJA1051 datasheet" }`.
     Any other key (`pages`, `page`) is refused; the pages go to `attach_datasheet` below.
   An existing id is refused unless you pass `replace: true` (never for a verified part). The
   human can do the same in the Studio with Library → New part….
3. Call `attach_datasheet` with `part`, the datasheet's `url`, its `title` and the `pages` of the
   pin table: `verification.md` then asks the human to compare each pin with that page. On the
   hosted service `create_part` refuses a part with more than three pins without `datasheet.url`.
   Tell the human the part is not verified and that `parts/<id>/verification.md` lists what to
   check.
4. Place it with `place_part`, connect it with `add_trace`, then run `check_circuit`.

## By LCSC number

When the human asks for a part by its LCSC number (for example `C7950`), call `import_part`
with `lcsc` (and `id` if they name one). It fetches the part's symbol, footprint and attributes
from EasyEDA and writes `parts/<id>/` with `part.yaml`, `footprint.yaml`, `verification.md` and
`source.md`. Pin types are `passive` except supply and ground pins, so set the real types with
`create_part` (`replace: true`, `package: { "file": "footprint.yaml" }`, no `footprint_file`) from
the datasheet when the checks need them: the imported pads, origin and `source.md` are kept. A
replace that changes the footprint (a footprint string or new pads) makes the part `written` and
removes `source.md` and the imported `footprint.yaml`. The footprint keeps EasyEDA's orientation
(dual packages with their rows horizontal and pin 1 at the bottom left; quad packages as the source draws them), which is JLCPCB's, so pick-and-place needs no
correction; place it at `pcbRotation -90` to match a generated footprint of the same package. Tell the human the
part is not verified, what the answer's notes say was approximated, and that the import is for
personal, non-commercial use only, as EasyEDA's terms allow (see `source.md`). Import one part per
request; never import in bulk. Offline it writes nothing: then create the part from the datasheet
instead. Parts whose pins are numbered with letters (BGA, many USB-C connectors) and footprints with
pads on the bottom side are refused; create those from the datasheet with `create_part`.

## From a photo

A photo shows the package and the marking, not the pinout. Identify the part from the marking,
then find its datasheet and follow the steps above. Say which identification you are unsure of.

## Rules

- You cannot mark a part verified, and you cannot replace a verified part. Ask the human.
- If the package has variants (for example SOT-23-5 pinouts differ between manufacturers),
  check the pin numbering against the exact orderable part number.
- When `check_circuit` warns that a pin needs power or ground, check the pin types first.
