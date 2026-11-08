/** One collator for every comparison: `localeCompare` with a locale builds a new one on each call. */
const collator = new Intl.Collator("en", { numeric: true })

/** Code point order, which never calls two different strings equal. */
function codePointCompare(a: string, b: string): number {
  const left = Array.from(a, (char) => char.codePointAt(0) as number)
  const right = Array.from(b, (char) => char.codePointAt(0) as number)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = (left[i] as number) - (right[i] as number)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

/**
 * Natural sort order: pin2 before pin10. Every list the model reports uses it. Names the collator
 * ranks equal, such as R01 and R1, fall back to code point order, so the order never depends on
 * the order the names came in.
 */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || codePointCompare(a, b)
}

export function sortedNatural(values: Iterable<string>): string[] {
  return [...values].sort(naturalCompare)
}
