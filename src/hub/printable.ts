// Text a person or a container could influence (a project or client name, an email, an engine's or a container's
// error output, a file name) never reaches the maintainer's terminal, the audit log or the status file as it is: control
// characters (C0 and C1, which include terminal escape sequences), bidirectional overrides and line breaks are replaced
// and the length is capped.

/**
 * Code point ranges replaced: C0 controls, DEL and C1 controls, the Arabic letter mark, zero-width space, joiners and
 * marks, line/paragraph separators, bidi overrides, the word joiner and invisible operators, bidi isolates, and the
 * byte-order mark (zero-width no-break space).
 */
const UNSAFE_RANGES: readonly [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x061c, 0x061c],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
]

export function isUnsafeCodePoint(code: number): boolean {
  return UNSAFE_RANGES.some(([low, high]) => code >= low && code <= high)
}

/**
 * `text` with every control, bidirectional, zero-width and line-breaking character replaced by "?", cut to `max` code
 * points (never in the middle of a surrogate pair).
 */
export function printable(text: unknown, max = 200): string {
  const points = Array.from(String(text ?? ""), (char) => (isUnsafeCodePoint(char.codePointAt(0) ?? 0) ? "?" : char))
  return points.length > max ? `${points.slice(0, Math.max(0, max - 3)).join("")}...` : points.join("")
}

/**
 * A log sink that writes each line of `text` on its own, through `printable`, behind `prefix`: a line break inside a
 * message (a container's output, an engine's error) can never start a line that looks like the hub's own.
 */
export function sanitisingLog(prefix: string, write: (text: string) => void = (text) => void process.stderr.write(text)): (text: string) => void {
  return (text) => {
    for (const line of String(text).split(/\r\n|\r|\n/)) if (line.trim() !== "") write(`${prefix}${printable(line, 1000)}\n`)
  }
}

/** The fixed categories a trash removal failure is recorded as, never the free text of the error. */
export type RemovalFailure = "timeout" | "engine-error" | "permission" | "not-empty" | "unknown"

export function removalFailure(message: string): RemovalFailure {
  if (/did not finish within|timed out|timeout/i.test(message)) return "timeout"
  if (/cleaning container failed|engine/i.test(message)) return "engine-error"
  if (/EACCES|EPERM|permission/i.test(message)) return "permission"
  if (/still there|not empty|ENOTEMPTY/i.test(message)) return "not-empty"
  return "unknown"
}
