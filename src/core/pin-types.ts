// The electrical pin types of a library part and the shapes of part ids, pin numbers and pin names. Its own module,
// with no imports, so the Studio can use it in the browser and the dialog and the core cannot drift apart.
export const PIN_TYPES = ["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive", "no_connect"] as const
export type PinType = (typeof PIN_TYPES)[number]

/** A part id, which is also a folder name. Ends with a letter or digit: Windows ignores trailing dots, so "Foo." could alias "Foo". */
export const PART_ID = /^[A-Za-z](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/

/** Pins are numbered 1, 2, 3 …. */
export const PIN_NUMBER = /^[1-9][0-9]*$/

/** Pin names become selectors: letters, digits and _, not starting with a digit. */
export const PIN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
