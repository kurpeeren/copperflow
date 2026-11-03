import { PCBViewer } from "@tscircuit/pcb-viewer"
import { useEffect, useState, type ComponentProps } from "react"
import type { CircuitData, CircuitElement } from "./api"
import type { Actions } from "./App"
import { nameOfPcbComponent } from "./circuit-json"
import { useHeight } from "./useHeight"

type EditEvent = NonNullable<ComponentProps<typeof PCBViewer>["editEvents"]>[number]

interface Props {
  json: CircuitElement[]
  /** Changes when a new build finishes. */
  buildId: string | undefined
  circuit: CircuitData
  actions: Actions
  selected: string | null
  onSelect(name: string): void
}

const round = (value: number) => Math.round(value * 100) / 100

/** The PCB in editing mode: dropping a dragged part writes its new pcbX/pcbY into the source. */
export function PcbPane({ json, buildId, circuit, actions, onSelect }: Props) {
  const { ref, height } = useHeight<HTMLDivElement>()
  const [events, setEvents] = useState<EditEvent[]>([])

  // A finished build already contains the committed moves.
  useEffect(() => setEvents([]), [buildId])

  const refuse = (text: string) => {
    setEvents([])
    actions.notify(text)
  }

  const onEditEventsChanged = (next: EditEvent[]) => {
    setEvents(next)
    const last = next[next.length - 1]
    if (!last || last.in_progress || last.edit_event_type !== "edit_pcb_component_location") return
    const name = nameOfPcbComponent(json, last.pcb_component_id)
    const part = circuit.model.parts.find((p) => p.name === name)
    if (!name || !part) return refuse("This part has no editable source element")
    onSelect(name)
    if (circuit.annotations.locks.some((lock) => lock.part === name)) return refuse(`${name} is locked`)
    if (!part.editable) return refuse(`${name} is read-only (${part.readonlyReason})`)
    const blocked = (["pcbX", "pcbY"] as const).find((key) => part.props[key] && !part.props[key]?.editable)
    if (blocked) return refuse(`${name}.${blocked} is an expression; change it in the code`)

    const shift = (key: "pcbX" | "pcbY", delta: number, absolute: number) => {
      const current = part.props[key]?.literal
      return round(typeof current === "number" ? current + delta : absolute)
    }
    const x = shift("pcbX", last.new_center.x - last.original_center.x, last.new_center.x)
    const y = shift("pcbY", last.new_center.y - last.original_center.y, last.new_center.y)
    void actions
      .edit([{ kind: "setProps", part: name, props: { pcbX: x, pcbY: y } }], `move ${name} to (${x}, ${y})`)
      .then((ok) => {
        if (!ok) setEvents([])
      })
  }

  const onBoundsSelected = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const text = window.prompt("Mark for the agent, e.g. route ground here")
    if (!text) return
    const at = { view: "pcb" as const, x: round((bounds.minX + bounds.maxX) / 2), y: round((bounds.minY + bounds.maxY) / 2) }
    void actions.mark(text, at)
  }

  return (
    <div className="pane" ref={ref}>
      <PCBViewer
        circuitJson={json as ComponentProps<typeof PCBViewer>["circuitJson"]}
        height={height}
        // WebGPU drew nothing in some embedded browsers; canvas works everywhere.
        renderer="canvas"
        allowEditing
        // Start with part moving switched on; the viewer's pencil button turns it off to pan.
        initialState={{ in_edit_mode: true, in_move_footprint_mode: true }}
        editEvents={events}
        onEditEventsChanged={onEditEventsChanged}
        onBoundsSelected={onBoundsSelected}
      />
    </div>
  )
}
