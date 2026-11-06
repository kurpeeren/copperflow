// The PCB's display unit. The model, the snap steps and every edit stay in mm; only what is shown changes.

export type Unit = "mm" | "mil"

export const MM_PER_MIL = 0.0254

/**
 * Zoom is shown against a fixed reference, not the fitted view, so it does not jump when the board
 * grows: 100% is 10 CSS pixels per mm (or per sheet unit).
 */
export const ZOOM_REFERENCE_PX = 10

export const nextUnit = (unit: Unit): Unit => (unit === "mm" ? "mil" : "mm")

export const toUnit = (mm: number, unit: Unit): number => (unit === "mil" ? mm / MM_PER_MIL : mm)

export const fromUnit = (value: number, unit: Unit): number => (unit === "mil" ? value * MM_PER_MIL : value)

/** A length in `mm` as shown: two decimals in mm, one in mil. Never "-0.00". */
export function formatLength(mm: number, unit: Unit): string {
  const text = toUnit(mm, unit).toFixed(unit === "mil" ? 1 : 2)
  return /^-0(\.0+)?$/.test(text) ? text.slice(1) : text
}

/** The snap select's label for a step in mm: "0.1 mm" or "3.94 mil". */
export function snapLabel(stepMm: number, unit: Unit): string {
  return `${Number(toUnit(stepMm, unit).toFixed(2))} ${unit}`
}

export const zoomPercent = (scale: number): number => Math.round((scale / ZOOM_REFERENCE_PX) * 100)
