# Writing code the human can edit

copperflow writes visual edits back into the source only where it can read the code
without running it. Code outside this subset still works, but it is read-only in the
editor and in the tools.

## Parts

- One JSX element per part, with a string-literal name: `<resistor name="R4" ... />`.
- Names are unique within a file.
- Position, rotation and values are literals: `pcbX={4.5}`, `pcbRotation={-90}`,
  `resistance="10k"`. Avoid `pcbX={x + 2}` or `pcbX={offset}` for anything the human may move.
- No spread props (`{...props}`) on parts the human should edit.
- Avoid `.map()` for parts the human will place one by one. A loop is fine for a row of
  identical parts that move together; they are shown as read-only.
- Objects such as `pinLabels={{ pin1: "VIN" }}` are fine; they are shown read-only, and the
  part's other props stay editable.

## Traces

- Literal selectors: `<trace from=".R1 > .pin1" to="net.GND" />` or `from="R1.pin1"`.
- Put traces as direct children of `<board>`, after the parts, one per line.
- Keep `</board>` on its own line so new traces can be added before it.

## Sub-components

A part inside a component defined outside the board, such as
`const Power = () => <group name="power">...</group>`, is editable. Editing it changes every
place the component is used.

## Pin names of the built-in kinds

Every pin answers to `pin<n>` and to the aliases below, so `R1.pin1`, `LED1.anode` and
`.LED1 > .pin1` all work. A `pinLabels` entry for a pin replaces the aliases of that pin; its names
come after `pin<n>`. A label may be one name or a list of names.

| Kind | Pins (number: names) |
|---|---|
| resistor, capacitor, inductor, fuse, crystal, switch | 1: pin1, left; 2: pin2, right |
| capacitor with `polarized` | 1: pin1, pos, anode; 2: pin2, neg, cathode |
| diode, led | 1: pin1, anode, pos; 2: pin2, cathode, neg |
| battery | 1: pin1, pos; 2: pin2, neg |
| potentiometer | 1: pin1; 2: pin2, wiper; 3: pin3 |
| resonator | 1: pin1; 2: pin2, gnd; 3: pin3 |
| pushbutton | 1 to 4: pin1 to pin4 |
| testpoint | 1: pin1 |
| transistor (`type` npn or pnp) | 1: pin1, B, base; 2: pin2, E, emitter; 3: pin3, C, collector |
| mosfet | 1: pin1, G, gate; 2: pin2, S, source; 3: pin3, D, drain |
| pinheader | 1 to `pinCount`: pin\<n\> |
| chip, connector | the numbers in `pinLabels` plus 1 to `pinCount`; with neither, one pin per pad of `footprint` |

A chip, connector or pinheader whose pins cannot be found this way (for example a connector with
only `standard="usb_c"`) has no pins and is reported as an `unsupported-element` error.
