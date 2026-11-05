# Creating library parts

Chips and connectors go into the project's parts library before they go into a circuit.
Passive parts (resistors, capacitors, LEDs, headers) are built in and need no entry.

## From a datasheet

1. Read the datasheet yourself. Find the package, the pin table and the ordering information.
2. Call `create_part` with:
   - `id`: the folder name, usually the part number, such as `AP2112K-3.3`.
   - `title`, `manufacturer`, `mpn` (the full orderable number, such as `AP2112K-3.3TRG1`).
   - `footprint`: a tscircuit footprint string for the package, such as `sot23_5`, `soic8`,
     `qfn32_p0.5mm` or `tssop20`. Use a footprint string whenever a family fits the package.
     When none fits, set `footprint` to `footprint.yaml` and pass `footprint_file`: transcribe
     every pad (number, shape, x, y, width, height, and a drill for through-hole pads) from the
     datasheet's recommended land pattern, name the page you took it from, and never estimate a
     coordinate. Each pad number must be a pin number; several pads may share one (a shell
     with two legs). Every pin except `no_connect` needs a pad. The part stays unverified
     until a human checks every pad against the datasheet.
   - `pins`: every pin by number, with the datasheet's name and an electrical type:
     `power_in`, `power_out`, `ground`, `input`, `output`, `bidirectional`, `passive` or
     `no_connect`. Pin names become selectors, so use letters, digits and `_` only
     (write `VCC_3V3`, not `+3.3V`).
   - `suppliers` (for example `jlcpcb: C51118`) and `datasheet.url` when you know them.
3. Tell the human the part is not verified and that `parts/<id>/verification.md` lists what to
   check, with the datasheet pages you used.
4. Place it with `place_part`, connect it with `add_trace`, then run `check_circuit`.

## From a photo

A photo shows the package and the marking, not the pinout. Identify the part from the marking,
then find its datasheet and follow the steps above. Say which identification you are unsure of.

## Rules

- You cannot mark a part verified, and you cannot replace a verified part. Ask the human.
- If the package has variants (for example SOT-23-5 pinouts differ between manufacturers),
  check the pin numbering against the exact orderable part number.
- When `check_circuit` warns that a pin needs power or ground, check the pin types first.
