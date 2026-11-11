// The electrical pin types of a library part. Its own module, with no imports, so the Studio can use it in the browser.
export const PIN_TYPES = ["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive", "no_connect"] as const
export type PinType = (typeof PIN_TYPES)[number]
