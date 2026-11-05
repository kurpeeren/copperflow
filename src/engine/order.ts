/** Natural sort order: pin2 before pin10. Every list the model reports uses it. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true })
}

export function sortedNatural(values: Iterable<string>): string[] {
  return [...values].sort(naturalCompare)
}
