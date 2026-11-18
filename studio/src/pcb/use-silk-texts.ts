// The PCB canvas's silkscreen texts (`<silkscreentext>`): a press on one selects it (toggled with Shift or Ctrl) and
// starts its drag; the release writes the move as one edit, and the text is drawn where it goes until the build has it.
// The one under the pointer is ringed. The logic is in silk-text-edit.ts and silk-text-draw.ts; this hook holds the
// state. A text is a board item, so the selection's board ids, Properties (pour-props.ts) and Delete (pour-tool.ts
// boardRemoval) treat it as they treat a pour or hole.
import { lockGate } from "../ai-lock-gate.js"
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react"
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { togglesSelection, type Selection, type SelectionChange } from "../selection"
import { toLocal } from "./canvas-common"
import { screenToWorld, snapPoint, type Camera, type Point, type Size } from "./geometry"
import type { LayerVisibility } from "./layers"
import { canPick } from "./pick"
import type { PickFilter } from "./pick-filter"
import { boardItemBlocker } from "./pour-tool"
import { DRAG_THRESHOLD_PX, type ArmedTool, type Press } from "./press"
import { dragOffset, silkTextMove, type SilkTextDrag, type Snap } from "./silk-text-edit"
import { silkTextAt, type SilkTextScene } from "./silk-text-draw"
import { graphicAt } from "./graphic-draw"

export interface SilkTextsInput {
  design: Design
  circuit: CircuitData
  actions: Actions
  camera: Camera | undefined
  size: Size
  canvas: RefObject<HTMLCanvasElement | null>
  layers: LayerVisibility
  filter: PickFilter
  armed: ArmedTool
  selection: Selection
  onSelect(change: SelectionChange): void
  step: number
  snap: boolean
}

/** How near a text, in CSS pixels, a press or the pointer still takes it. */
const SLACK_PX = 3

const locksOf = (circuit: CircuitData): ReadonlySet<string> => new Set(circuit.annotations.locks.map((lock) => lock.part))

/** The text under a point, when a text may be picked there. */
function textUnder(input: SilkTextsInput, world: Point): string | undefined {
  const { camera, selection, armed, filter, layers } = input
  if (!camera || !canPick({ kind: "text", id: "" }, { selection, armed, filter })) return undefined
  const slack = SLACK_PX / camera.scale
  return silkTextAt(input.design.pcb.silkTexts ?? [], world, layers, slack)?.id ?? graphicAt(input.design.pcb.graphics ?? [], world, layers, slack)?.id
}

/** The board text or drawing with this id: both move by their centre. */
const markOf = (design: Design, id: string) => (design.pcb.silkTexts ?? []).find((one) => one.id === id) ?? (design.pcb.graphics ?? []).find((one) => one.id === id)

/** A left press on a text selects it and starts its drag; a locked or read-only one is selected and says why it stays. */
function pressText(input: SilkTextsInput, event: Press, world: Point, put: (drag: SilkTextDrag) => void): boolean {
  if (event.button !== 0) return false
  const id = textUnder(input, world)
  if (id === undefined) return false
  const { onSelect, circuit, actions } = input
  onSelect((current) => (togglesSelection(event) ? current.toggleBoard(id) : current.onlyBoard(id)))
  if (togglesSelection(event)) return true
  const blocker = boardItemBlocker(circuit.model, locksOf(circuit), id)
  if (blocker) actions.notify(`Not movable: ${blocker}`)
  else put({ id, start: world, to: world, moved: false })
  return true
}

/** Writes a finished drag's move as one edit; the text is shown at its new place (`show`) until the build, or put back on a refusal. */
function writeMove(input: SilkTextsInput, drag: SilkTextDrag, snap: Snap, show: (moved: { id: string; by: Point } | undefined) => void): void {
  const text = markOf(input.design, drag.id)
  const change = text && silkTextMove(text, drag, snap)
  const by = text && dragOffset(text, drag, snap)
  if (!text || !change || !by) return
  show({ id: text.id, by })
  void input.actions
    .edit([change.edit], change.summary)
    .catch((error: unknown) => {
      input.actions.notify(`Not written: ${error instanceof Error ? error.message : String(error)}`)
      return false
    })
    .then((ok) => ok || show(undefined))
}

export function useSilkTexts(input: SilkTextsInput) {
  const [drag, setDrag] = useState<SilkTextDrag>()
  const dragRef = useRef<SilkTextDrag | undefined>(undefined)
  const [hover, setHover] = useState<string>()
  // A moved text stays where it was dropped until the build after its edit lands.
  const [sent, setSent] = useState<{ id: string; by: Point }>()
  useEffect(() => setSent(undefined), [input.design])
  const latest = useRef(input)
  latest.current = input
  const put = (next: SilkTextDrag | undefined) => {
    dragRef.current = next
    setDrag(next)
  }
  const snap: Snap = (p) => snapPoint(p, input.step, input.snap)
  const dragged = drag && markOf(input.design, drag.id)
  const by = dragged ? dragOffset(dragged, drag, snap) : undefined
  const moving = by && drag ? { id: drag.id, by } : sent
  const scene: SilkTextScene = { selected: new Set(input.selection.board), ...(hover === undefined ? {} : { hovered: hover }), ...(moving ? { moving } : {}) }
  return {
    press: (event: Press, world: Point) => pressText(latest.current, event, world, put),
    hoverAt: (world: Point): boolean => {
      const id = textUnder(latest.current, world)
      setHover(id)
      return id !== undefined
    },
    clearHover: () => setHover(undefined),
    dragRef,
    put,
    release: (current: SilkTextDrag) => {
      put(undefined)
      writeMove(latest.current, current, snap, setSent)
    },
    latest,
    scene,
    cursor: drag?.moved ? "move" : hover !== undefined ? "pointer" : undefined,
  }
}

type SilkTextState = ReturnType<typeof useSilkTexts>

type Handlers = {
  onPointerMove(event: PointerEvent<Element>): void
  onPointerUp(event: PointerEvent<Element>): void
  onPointerCancel(): void
  onLostPointerCapture(): void
}

/** The canvas's pointer handlers with a text's drag taking the moves and the release while it runs. */
export function withSilkTextDrag<H extends Handlers>(texts: SilkTextState, handlers: H, setCursor: (world: Point) => void): H {
  const worldOf = (event: PointerEvent<Element>): Point | undefined => {
    const { camera, size, canvas } = texts.latest.current
    return camera ? screenToWorld(camera, size, toLocal(canvas.current, size, event)) : undefined
  }
  return {
    ...handlers,
    onPointerMove: (event) => {
      const drag = texts.dragRef.current
      const world = drag && worldOf(event)
      if (!drag || !world) return handlers.onPointerMove(event)
      setCursor(world)
      if (event.buttons === 0) return void texts.put(undefined)
      const far = Math.hypot(world.x - drag.start.x, world.y - drag.start.y) * (texts.latest.current.camera?.scale ?? 1) >= DRAG_THRESHOLD_PX
      if (!drag.moved && !far) return
      // While the AI lock is closed a text does not follow the pointer.
      if (lockGate.refuses()) return
      texts.put({ ...drag, moved: true, to: world })
    },
    onPointerUp: (event) => {
      const drag = texts.dragRef.current
      if (drag) texts.release(drag)
      else handlers.onPointerUp(event)
    },
    onPointerCancel: () => {
      texts.put(undefined)
      handlers.onPointerCancel()
    },
    onLostPointerCapture: () => {
      texts.put(undefined)
      handlers.onLostPointerCapture()
    },
  }
}
