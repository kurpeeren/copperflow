// A reader for the s-expression text KiCad saves its boards in, written from the format's public description: lists in
// brackets, symbols and numbers separated by white space, strings in double quotes with backslash escapes. A line whose
// first character (after spaces) is `#` is a comment, so a person can note why a hand-written file is as it is.
// Iterative, with limits, so a huge or hostile file cannot run the program out of stack or memory.

/** A symbol, a number or a string as written; `quoted` for a string. */
export interface SAtom {
  atom: string
  quoted: boolean
}

export interface SList {
  list: SNode[]
  /** The line the list opened on. */
  line: number
}

export type SNode = SAtom | SList

export class SexprError extends Error {}

/** The deepest nesting read; KiCad's boards nest about a dozen lists deep. */
export const MAX_DEPTH = 100
/** The most atoms and lists read: far beyond a board of thousands of parts. */
export const MAX_NODES = 8_000_000

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"' }

const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f"

/** Reads one quoted string starting at `start` (the quote); answers its text and the index after the closing quote. */
function readString(text: string, start: number, line: number): { value: string; end: number; lines: number } {
  let value = ""
  let lines = 0
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i] as string
    if (c === '"') return { value, end: i + 1, lines }
    if (c === "\\" && i + 1 < text.length) {
      const next = text[++i] as string
      value += ESCAPES[next] ?? next
      continue
    }
    if (c === "\n") lines++
    value += c
  }
  throw new SexprError(`A string opened on line ${line} is not closed`)
}

/** Whether the line starting at `i` (after its spaces) is a comment line. */
function commentEnd(text: string, i: number, atLineStart: boolean): number | undefined {
  if (!atLineStart || text[i] !== "#") return undefined
  const end = text.indexOf("\n", i)
  return end < 0 ? text.length : end
}

/** Reads the file's one top-level list. */
export function readSexpr(text: string): SList {
  const stack: SList[] = []
  let top: SList | undefined
  let line = 1
  let atLineStart = true
  let nodes = 0
  const add = (node: SNode) => {
    if (++nodes > MAX_NODES) throw new SexprError(`The file has more than ${MAX_NODES} items, more than copperflow reads`)
    const parent = stack[stack.length - 1]
    if (parent) parent.list.push(node)
    else if (top) throw new SexprError(`Line ${line} has more after the end of the file's list`)
    else throw new SexprError("The file does not start with a list")
  }
  for (let i = 0; i < text.length; ) {
    const c = text[i] as string
    if (isSpace(c)) {
      if (c === "\n") {
        line++
        atLineStart = true
      }
      i++
      continue
    }
    const comment = commentEnd(text, i, atLineStart)
    if (comment !== undefined) {
      i = comment
      continue
    }
    atLineStart = false
    if (c === "(") {
      if (top && stack.length === 0) throw new SexprError(`Line ${line} has more after the end of the file's list`)
      if (stack.length >= MAX_DEPTH) throw new SexprError(`Line ${line} is nested deeper than ${MAX_DEPTH} lists, more than a board has`)
      const list: SList = { list: [], line }
      if (stack.length > 0) add(list)
      else top = list
      stack.push(list)
      i++
    } else if (c === ")") {
      if (stack.length === 0) throw new SexprError(`Line ${line} closes a list that was never opened`)
      stack.pop()
      i++
    } else if (c === '"') {
      const read = readString(text, i, line)
      add({ atom: read.value, quoted: true })
      line += read.lines
      i = read.end
    } else {
      let end = i
      while (end < text.length && !isSpace(text[end] as string) && text[end] !== "(" && text[end] !== ")" && text[end] !== '"') end++
      add({ atom: text.slice(i, end), quoted: false })
      i = end
    }
  }
  if (stack.length > 0) throw new SexprError(`The file ends before every list is closed: the list opened on line ${(stack[stack.length - 1] as SList).line} is not closed`)
  if (!top) throw new SexprError(text.trim() === "" ? "The file is empty" : "The file does not start with a list")
  return top
}

export const isList = (node: SNode | undefined): node is SList => node !== undefined && "list" in node

/** The text of an atom; undefined for a list or nothing. */
export function atomText(node: SNode | undefined): string | undefined {
  return node !== undefined && "atom" in node ? node.atom : undefined
}

/** The symbol a list starts with, e.g. "footprint"; undefined when it starts with a list or a string. */
export function head(list: SList): string | undefined {
  const first = list.list[0]
  return first !== undefined && "atom" in first && !first.quoted ? first.atom : undefined
}

/** The lists inside `list` that start with `name`. */
export function children(list: SList, name: string): SList[] {
  return list.list.filter((node): node is SList => isList(node) && head(node) === name)
}

/** The first list inside `list` that starts with `name`. */
export function child(list: SList, name: string): SList | undefined {
  return list.list.find((node): node is SList => isList(node) && head(node) === name)
}

/** The number at `index` of a list; undefined when it is missing, quoted or not a number. */
export function numberAt(list: SList | undefined, index: number): number | undefined {
  const node = list?.list[index]
  if (node === undefined || !("atom" in node) || node.quoted || node.atom === "") return undefined
  const value = Number(node.atom)
  return Number.isFinite(value) ? value : undefined
}

/** The text of the atom at `index`, quoted or not. */
export function textAt(list: SList | undefined, index: number): string | undefined {
  return atomText(list?.list[index])
}

/** The texts of every atom after the head, e.g. the names in (layers "F.Cu" "B.Cu"). */
export function texts(list: SList | undefined): string[] {
  return (list?.list.slice(1) ?? []).flatMap((node) => ("atom" in node ? [node.atom] : []))
}

/** The yes/no value of a child such as (hide yes), or a bare flag such as `hide` in older files. */
export function flag(list: SList, name: string): boolean {
  const found = child(list, name)
  if (found) return textAt(found, 1) !== "no"
  return list.list.some((node) => "atom" in node && !node.quoted && node.atom === name)
}
