// Text a person or a container could influence (a project or client name, an email, an engine's or a container's
// error output, a file name) never reaches the maintainer's terminal, the audit log or the status file as it is: control
// characters (C0 and C1, which include terminal escape sequences), bidirectional overrides and line breaks are replaced
// and the length is capped.

/** Code point ranges replaced: C0 controls, DEL and C1 controls, bidi marks, line/paragraph separators, bidi overrides and isolates. */
const UNSAFE_RANGES: readonly [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200e, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]

export function isUnsafeCodePoint(code: number): boolean {
  return UNSAFE_RANGES.some(([low, high]) => code >= low && code <= high)
}

/** `text` with every control, bidirectional and line-breaking character replaced by "?", cut to `max` characters. */
export function printable(text: unknown, max = 200): string {
  let plain = ""
  for (const char of String(text ?? "")) plain += isUnsafeCodePoint(char.codePointAt(0) ?? 0) ? "?" : char
  return plain.length > max ? `${plain.slice(0, Math.max(0, max - 3))}...` : plain
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
