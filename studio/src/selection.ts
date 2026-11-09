// The selection: the parts and the schematic wires picked, each list in the order it was picked, so the last part (the
// primary) can stand for the rest where only one part makes sense, such as the Properties of a single part or centring
// the camera. A value: every change returns a new selection, or the same one when nothing changed, so React sees what
// changed. The part counts (`names`, `size`, `primary`) count parts only, so the part commands (Rotate, align, Lock)
// act on the parts; `wires` holds the wires, and `total` counts both, as "Selected objects: N" does.

/** A change to the selection, from what it is to what it becomes; the canvases, panels and keys send these. */
export type SelectionChange = (current: Selection) => Selection

const unique = (items: readonly string[]): string[] => [...new Set(items)]
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, i) => item === b[i])

export class Selection {
  /** Nothing selected. */
  static readonly none: Selection = new Selection([], [])

  /** The part names, each once, oldest pick first. */
  readonly names: readonly string[]

  /** The schematic wires, by their ids in the sheet's layout, each once, oldest pick first. */
  readonly wires: readonly string[]

  private constructor(names: readonly string[], wires: readonly string[]) {
    this.names = Object.freeze([...names])
    this.wires = Object.freeze([...wires])
    Object.freeze(this)
  }

  private static from(names: readonly string[], wires: readonly string[]): Selection {
    return names.length === 0 && wires.length === 0 ? Selection.none : new Selection(names, wires)
  }

  /** The part picked last, or undefined when no part is selected. */
  get primary(): string | undefined {
    return this.names.at(-1)
  }

  /** How many parts are selected. */
  get size(): number {
    return this.names.length
  }

  get wireCount(): number {
    return this.wires.length
  }

  /** Every object selected: the parts and the wires. */
  get total(): number {
    return this.names.length + this.wires.length
  }

  /** The wire when it is all that is selected (one wire, no part): the one its handles, reshaping and Wire section are for. */
  get soleWire(): string | undefined {
    return this.names.length === 0 && this.wires.length === 1 ? this.wires[0] : undefined
  }

  has(name: string): boolean {
    return this.names.includes(name)
  }

  hasWire(id: string): boolean {
    return this.wires.includes(id)
  }

  /** Just this part. */
  only(name: string): Selection {
    return this.wires.length === 0 && sameList(this.names, [name]) ? this : new Selection([name], [])
  }

  /** Just this wire. */
  onlyWire(id: string): Selection {
    return this.names.length === 0 && sameList(this.wires, [id]) ? this : new Selection([], [id])
  }

  /** The part taken out when it is in, else added as the primary; the wires stay. */
  toggle(name: string): Selection {
    return this.has(name) ? this.without([name]) : new Selection([...this.names, name], this.wires)
  }

  /** The wire taken out when it is in, else added after the others; the parts stay. */
  toggleWire(id: string): Selection {
    return this.hasWire(id) ? this.withoutWires([id]) : new Selection(this.names, [...this.wires, id])
  }

  /** The parts not in yet, added in order; the ones already in stay where they are. */
  add(names: readonly string[]): Selection {
    const fresh = unique(names).filter((name) => !this.has(name))
    return fresh.length === 0 ? this : new Selection([...this.names, ...fresh], this.wires)
  }

  /** The wires not in yet, added in order. */
  addWires(ids: readonly string[]): Selection {
    const fresh = unique(ids).filter((id) => !this.hasWire(id))
    return fresh.length === 0 ? this : new Selection(this.names, [...this.wires, ...fresh])
  }

  clear(): Selection {
    return Selection.none
  }

  /** Every one of these parts and wires, each once, and nothing else. */
  all(names: readonly string[], wires: readonly string[] = []): Selection {
    const [everyPart, everyWire] = [unique(names), unique(wires)]
    return sameList(everyPart, this.names) && sameList(everyWire, this.wires) ? this : Selection.from(everyPart, everyWire)
  }

  /** The selection less these parts. */
  without(names: readonly string[]): Selection {
    const left = this.names.filter((name) => !names.includes(name))
    return left.length === this.names.length ? this : Selection.from(left, this.wires)
  }

  /** The selection less these wires. */
  withoutWires(ids: readonly string[]): Selection {
    const left = this.wires.filter((id) => !ids.includes(id))
    return left.length === this.wires.length ? this : Selection.from(this.names, left)
  }

  /** Only the selected parts that are among these, such as the parts the circuit still has. */
  keep(names: Iterable<string>): Selection {
    const kept = new Set(names)
    const left = this.names.filter((name) => kept.has(name))
    return left.length === this.names.length ? this : Selection.from(left, this.wires)
  }

  /** Only the selected wires that are among these, such as the wires the sheet still draws (deleted or undone ones go). */
  keepWires(ids: Iterable<string>): Selection {
    const kept = new Set(ids)
    const left = this.wires.filter((id) => kept.has(id))
    return left.length === this.wires.length ? this : Selection.from(this.names, left)
  }
}

/** The modifiers of a click that toggles one part in or out instead of selecting it alone: Shift or Ctrl, as in EasyEDA (Cmd on a Mac). */
export interface ClickModifiers {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export function togglesSelection(modifiers: ClickModifiers): boolean {
  return modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey
}

/** What a click on a part does: selects it alone, or with Shift or Ctrl held toggles it. */
export function clicked(name: string, modifiers: ClickModifiers): SelectionChange {
  const toggle = togglesSelection(modifiers)
  return (current) => (toggle ? current.toggle(name) : current.only(name))
}

/** The parts `before` had that `after` has no longer, in their order; a name `before` never had is not among them. */
export function goneFrom(before: readonly string[], after: readonly string[]): string[] {
  const kept = new Set(after)
  return before.filter((name) => !kept.has(name))
}
