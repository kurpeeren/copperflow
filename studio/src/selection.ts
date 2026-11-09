// The selection: the parts picked, in the order they were picked, so the last one (the primary) can stand for the
// rest where only one part makes sense, such as the Properties of a single part or centring the camera. A value:
// every change returns a new selection, or the same one when nothing changed, so React sees what changed.

/** A change to the selection, from what it is to what it becomes; the canvases, panels and keys send these. */
export type SelectionChange = (current: Selection) => Selection

export class Selection {
  /** Nothing selected. */
  static readonly none: Selection = new Selection([])

  /** The part names, each once, oldest pick first. */
  readonly names: readonly string[]

  private constructor(names: readonly string[]) {
    this.names = Object.freeze([...names])
    Object.freeze(this)
  }

  private static from(names: readonly string[]): Selection {
    return names.length === 0 ? Selection.none : new Selection(names)
  }

  /** The part picked last, or undefined when nothing is selected. */
  get primary(): string | undefined {
    return this.names.at(-1)
  }

  get size(): number {
    return this.names.length
  }

  has(name: string): boolean {
    return this.names.includes(name)
  }

  /** Just this part. */
  only(name: string): Selection {
    return this.names.length === 1 && this.names[0] === name ? this : new Selection([name])
  }

  /** The part taken out when it is in, else added as the primary. */
  toggle(name: string): Selection {
    return this.has(name) ? this.without([name]) : new Selection([...this.names, name])
  }

  /** The parts not in yet, added in order; the ones already in stay where they are. */
  add(names: readonly string[]): Selection {
    const fresh = [...new Set(names)].filter((name) => !this.has(name))
    return fresh.length === 0 ? this : new Selection([...this.names, ...fresh])
  }

  clear(): Selection {
    return Selection.none
  }

  /** Every one of these parts, each once, and nothing else. */
  all(names: readonly string[]): Selection {
    const every = [...new Set(names)]
    const same = every.length === this.names.length && every.every((name, i) => name === this.names[i])
    return same ? this : Selection.from(every)
  }

  /** The selection less these parts. */
  without(names: readonly string[]): Selection {
    const left = this.names.filter((name) => !names.includes(name))
    return left.length === this.names.length ? this : Selection.from(left)
  }

  /** Only the selected parts that are among these, such as the parts the circuit still has. */
  keep(names: Iterable<string>): Selection {
    const kept = new Set(names)
    const left = this.names.filter((name) => kept.has(name))
    return left.length === this.names.length ? this : Selection.from(left)
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
