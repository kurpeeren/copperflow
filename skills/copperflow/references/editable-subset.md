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
