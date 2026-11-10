// The selection: the parts, the schematic wires, the net labels and flags, the drawings, the PCB's copper (tracks
// and vias, by their layout ids) and the parts' names and values (texts) picked, each list in the
// order it was picked, so the last part (the primary) can stand for the rest where only one part makes sense, such as
// the Properties of a single part or centring the camera. A value: every change returns a new selection, or the same
// one when nothing changed, so React sees what changed. The part counts (`names`, `size`, `primary`) count parts only,
// so the part commands (Rotate, align, Lock) act on the parts; `wires` holds the wires, `labels` the labels, `drawings`
// the drawings, `copper` the tracks and vias, and `total` counts all five, as "Selected objects: N" does.

/** A change to the selection, from what it is to what it becomes; the canvases, panels and keys send these. */
export type SelectionChange = (current: Selection) => Selection

const unique = (items: readonly string[]): string[] => [...new Set(items)]
/** Whether two lists hold the same items in the same order. */
export const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, i) => item === b[i])

/** The items not among `taken`, in their order. */
const less = (items: readonly string[], taken: readonly string[]): string[] => items.filter((item) => !taken.includes(item))
/** The items among `kept`, in their order. */
const among = (items: readonly string[], kept: Iterable<string>): string[] => {
  const set = new Set(kept)
  return items.filter((item) => set.has(item))
}

/** The six lists a selection holds. */
interface Lists {
  names: readonly string[]
  wires: readonly string[]
  labels: readonly string[]
  drawings: readonly string[]
  copper: readonly string[]
  texts: readonly string[]
}

const EMPTY: Lists = { names: [], wires: [], labels: [], drawings: [], copper: [], texts: [] }
const KEYS: readonly (keyof Lists)[] = ["names", "wires", "labels", "drawings", "copper", "texts"]

export class Selection {
  /** Nothing selected. */
  static readonly none: Selection = new Selection(EMPTY)

  /** The part names, each once, oldest pick first. */
  readonly names: readonly string[]

  /** The schematic wires, by their ids in the sheet's layout, each once, oldest pick first. */
  readonly wires: readonly string[]

  /** The net labels and ground or power flags on the schematic, by their ids in the sheet's layout, oldest pick first. */
  readonly labels: readonly string[]

  /** The schematic drawings (lines, shapes, texts and buses), by their ids in the sheet's layout, oldest pick first. */
  readonly drawings: readonly string[]

  /** The PCB's tracks and vias, by their ids in the layout file (`t0001`, `v0001`), oldest pick first. */
  readonly copper: readonly string[]

  /** Parts' names and values on the schematic and designators on the silkscreen, as "<part>:<prop>" ("R1:schNameAt"), oldest pick first. */
  readonly texts: readonly string[]

  private constructor(lists: Lists) {
    this.names = Object.freeze([...lists.names])
    this.wires = Object.freeze([...lists.wires])
    this.labels = Object.freeze([...lists.labels])
    this.drawings = Object.freeze([...lists.drawings])
    this.copper = Object.freeze([...lists.copper])
    this.texts = Object.freeze([...lists.texts])
    Object.freeze(this)
  }

  private static from(lists: Lists): Selection {
    return KEYS.every((key) => lists[key].length === 0) ? Selection.none : new Selection(lists)
  }

  private get lists(): Lists {
    return { names: this.names, wires: this.wires, labels: this.labels, drawings: this.drawings, copper: this.copper, texts: this.texts }
  }

  /** This selection with some lists changed: itself when every list kept its length (lists are only ever shortened or kept here). */
  private with(changed: Partial<Lists>): Selection {
    const next = { ...this.lists, ...changed }
    return KEYS.every((key) => next[key].length === this[key].length) ? this : Selection.from(next)
  }

  /** A new selection with some lists changed (grown). */
  private grown(changed: Partial<Lists>): Selection {
    return new Selection({ ...this.lists, ...changed })
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

  get labelCount(): number {
    return this.labels.length
  }

  get drawingCount(): number {
    return this.drawings.length
  }

  get copperCount(): number {
    return this.copper.length
  }

  get textCount(): number {
    return this.texts.length
  }

  /** Every object selected: the parts, the wires, the labels, the drawings, the copper and the names and values. */
  get total(): number {
    return this.names.length + this.wires.length + this.labels.length + this.drawings.length + this.copper.length + this.texts.length
  }

  /** The name, value or designator when it is all that is selected: the one Properties, the arrows and a drag move. */
  get soleText(): string | undefined {
    return this.total === 1 ? this.texts[0] : undefined
  }

  /** The track or via when it is all that is selected: the one Properties shows the rows of. */
  get soleCopper(): string | undefined {
    return this.total === 1 ? this.copper[0] : undefined
  }

  /** The wire when it is all that is selected (one wire, nothing else): the one its handles, reshaping and Wire section are for. */
  get soleWire(): string | undefined {
    return this.total === 1 ? this.wires[0] : undefined
  }

  /** The label when it is all that is selected: the one Properties shows the rows of. */
  get soleLabel(): string | undefined {
    return this.total === 1 ? this.labels[0] : undefined
  }

  /** The drawing when it is all that is selected: the one Properties shows the fields of. */
  get soleDrawing(): string | undefined {
    return this.total === 1 ? this.drawings[0] : undefined
  }

  has(name: string): boolean {
    return this.names.includes(name)
  }

  hasWire(id: string): boolean {
    return this.wires.includes(id)
  }

  hasLabel(id: string): boolean {
    return this.labels.includes(id)
  }

  hasDrawing(id: string): boolean {
    return this.drawings.includes(id)
  }

  hasCopper(id: string): boolean {
    return this.copper.includes(id)
  }

  hasText(id: string): boolean {
    return this.texts.includes(id)
  }

  /** Just this part. */
  only(name: string): Selection {
    return this.total === 1 && this.names[0] === name ? this : new Selection({ ...EMPTY, names: [name] })
  }

  /** Just this wire. */
  onlyWire(id: string): Selection {
    return this.soleWire === id ? this : new Selection({ ...EMPTY, wires: [id] })
  }

  /** Just this label. */
  onlyLabel(id: string): Selection {
    return this.soleLabel === id ? this : new Selection({ ...EMPTY, labels: [id] })
  }

  /** Just this drawing. */
  onlyDrawing(id: string): Selection {
    return this.soleDrawing === id ? this : new Selection({ ...EMPTY, drawings: [id] })
  }

  /** Just this name, value or designator. */
  onlyText(id: string): Selection {
    return this.soleText === id ? this : new Selection({ ...EMPTY, texts: [id] })
  }

  /** Just this track or via. */
  onlyCopper(id: string): Selection {
    return this.soleCopper === id ? this : new Selection({ ...EMPTY, copper: [id] })
  }

  /** The part taken out when it is in, else added as the primary; the other kinds stay. */
  toggle(name: string): Selection {
    return this.has(name) ? this.without([name]) : this.grown({ names: [...this.names, name] })
  }

  /** The wire taken out when it is in, else added after the others; the other kinds stay. */
  toggleWire(id: string): Selection {
    return this.hasWire(id) ? this.withoutWires([id]) : this.grown({ wires: [...this.wires, id] })
  }

  /** The label taken out when it is in, else added after the others; the other kinds stay. */
  toggleLabel(id: string): Selection {
    return this.hasLabel(id) ? this.withoutLabels([id]) : this.grown({ labels: [...this.labels, id] })
  }

  /** The drawing taken out when it is in, else added after the others; the other kinds stay. */
  toggleDrawing(id: string): Selection {
    return this.hasDrawing(id) ? this.withoutDrawings([id]) : this.grown({ drawings: [...this.drawings, id] })
  }

  /** The track or via taken out when it is in, else added after the others; the other kinds stay. */
  toggleCopper(id: string): Selection {
    return this.hasCopper(id) ? this.withoutCopper([id]) : this.grown({ copper: [...this.copper, id] })
  }

  /** The name, value or designator taken out when it is in, else added after the others; the other kinds stay. */
  toggleText(id: string): Selection {
    return this.hasText(id) ? this.with({ texts: less(this.texts, [id]) }) : this.grown({ texts: [...this.texts, id] })
  }

  /** The parts not in yet, added in order; the ones already in stay where they are. */
  add(names: readonly string[]): Selection {
    const fresh = unique(names).filter((name) => !this.has(name))
    return fresh.length === 0 ? this : this.grown({ names: [...this.names, ...fresh] })
  }

  /** The wires not in yet, added in order. */
  addWires(ids: readonly string[]): Selection {
    const fresh = unique(ids).filter((id) => !this.hasWire(id))
    return fresh.length === 0 ? this : this.grown({ wires: [...this.wires, ...fresh] })
  }

  /** The labels not in yet, added in order. */
  addLabels(ids: readonly string[]): Selection {
    const fresh = unique(ids).filter((id) => !this.hasLabel(id))
    return fresh.length === 0 ? this : this.grown({ labels: [...this.labels, ...fresh] })
  }

  /** The drawings not in yet, added in order. */
  addDrawings(ids: readonly string[]): Selection {
    const fresh = unique(ids).filter((id) => !this.hasDrawing(id))
    return fresh.length === 0 ? this : this.grown({ drawings: [...this.drawings, ...fresh] })
  }

  /** The tracks and vias not in yet, added in order. */
  addCopper(ids: readonly string[]): Selection {
    const fresh = unique(ids).filter((id) => !this.hasCopper(id))
    return fresh.length === 0 ? this : this.grown({ copper: [...this.copper, ...fresh] })
  }

  clear(): Selection {
    return Selection.none
  }

  /** Every one of these parts, wires, labels, drawings and tracks or vias, each once, and nothing else (no name or value). */
  all(names: readonly string[], wires: readonly string[] = [], labels: readonly string[] = [], drawings: readonly string[] = [], copper: readonly string[] = []): Selection {
    const next: Lists = { names: unique(names), wires: unique(wires), labels: unique(labels), drawings: unique(drawings), copper: unique(copper), texts: [] }
    return KEYS.every((key) => sameList(next[key], this[key])) ? this : Selection.from(next)
  }

  /** The selection less these parts. */
  without(names: readonly string[]): Selection {
    return this.with({ names: less(this.names, names) })
  }

  /** The selection less these wires. */
  withoutWires(ids: readonly string[]): Selection {
    return this.with({ wires: less(this.wires, ids) })
  }

  /** The selection less these labels. */
  withoutLabels(ids: readonly string[]): Selection {
    return this.with({ labels: less(this.labels, ids) })
  }

  /** The selection less these drawings. */
  withoutDrawings(ids: readonly string[]): Selection {
    return this.with({ drawings: less(this.drawings, ids) })
  }

  /** The selection less these tracks and vias. */
  withoutCopper(ids: readonly string[]): Selection {
    return this.with({ copper: less(this.copper, ids) })
  }

  /** Only the selected parts that are among these, such as the parts the circuit still has. */
  keep(names: Iterable<string>): Selection {
    return this.with({ names: among(this.names, names) })
  }

  /** Only the selected wires that are among these, such as the wires the sheet still draws (deleted or undone ones go). */
  keepWires(ids: Iterable<string>): Selection {
    return this.with({ wires: among(this.wires, ids) })
  }

  /** Only the selected labels that are among these, such as the labels the sheet still draws. */
  keepLabels(ids: Iterable<string>): Selection {
    return this.with({ labels: among(this.labels, ids) })
  }

  /** Only the selected drawings that are among these, such as the drawings the sheet still draws. */
  keepDrawings(ids: Iterable<string>): Selection {
    return this.with({ drawings: among(this.drawings, ids) })
  }

  /** The selection less these names, values and designators. */
  withoutTexts(ids: readonly string[]): Selection {
    return this.with({ texts: less(this.texts, ids) })
  }

  /** Only the selected names, values and designators that are among these, such as those of the parts still drawn. */
  keepTexts(ids: Iterable<string>): Selection {
    return this.with({ texts: among(this.texts, ids) })
  }

  /** Only the selected tracks and vias that are among these, such as those the layout file still has. */
  keepCopper(ids: Iterable<string>): Selection {
    return this.with({ copper: among(this.copper, ids) })
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
