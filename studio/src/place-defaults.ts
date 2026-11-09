/** Starting values for built-in parts, so a placed part has a value and a footprint at once. */
export const PLACE_DEFAULTS: Record<string, Record<string, string>> = {
  resistor: { resistance: "10k", footprint: "0402" },
  capacitor: { capacitance: "100nF", footprint: "0402" },
  inductor: { inductance: "10uH", footprint: "0805" },
  led: { color: "red", footprint: "0603" },
  crystal: { frequency: "16MHz" },
  fuse: { currentRating: "500mA", footprint: "1206" },
}
