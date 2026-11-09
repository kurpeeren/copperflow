// WCAG 2 contrast between two colours: (L1 + 0.05) / (L2 + 0.05) of their relative luminances, lighter over darker.
// Text needs 4.5:1, other marks (an underline, an icon) 3:1. A test holds the chrome's tokens to it.

/** The 0–1 channels of `#rgb` or `#rrggbb`. */
function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match?.[1]) throw new Error(`not a hex colour: ${hex}`)
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1]
  return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16) / 255) as [number, number, number]
}

/** Relative luminance, from linearised sRGB channels. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The contrast ratio of two hex colours, from 1 (the same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}
