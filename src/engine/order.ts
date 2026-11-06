/** One collator for every comparison: `localeCompare` with a locale builds a new one on each call. */
const collator = new Intl.Collator("en", { numeric: true })

/** Natural sort order: pin2 before pin10. Every list the model reports uses it. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}

export function sortedNatural(values: Iterable<string>): string[] {
  return [...values].sort(naturalCompare)
}
