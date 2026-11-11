import { useId, useState, type FormEvent } from "react"
import { NEW_BOARD, newCircuitRequest, type NewCircuitRequest } from "./new-circuit-form"

/** What File → New circuit… asks: the file written, after which the Studio opens it. */
export interface NewCircuitPanel {
  create(request: NewCircuitRequest): Promise<boolean>
}

/** File → New circuit…: a name and a board size; the server writes the empty circuit as one history entry. */
export function NewCircuitForm({ panel, onClose }: { panel: NewCircuitPanel; onClose(): void }) {
  const [name, setName] = useState("")
  const [width, setWidth] = useState(String(NEW_BOARD.width))
  const [height, setHeight] = useState(String(NEW_BOARD.height))
  const [problem, setProblem] = useState<string>()
  const [busy, setBusy] = useState(false)
  const id = useId()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const request = newCircuitRequest(name, width, height)
    if ("message" in request) return setProblem(request.message)
    setBusy(true)
    const made = await panel.create(request)
    setBusy(false)
    if (made) onClose()
  }
  return (
    <form className="rules-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} value={name} placeholder="power-board" onChange={(event) => setName(event.target.value)} aria-invalid={problem !== undefined} />
      <label htmlFor={`${id}-w`}>Board width (mm)</label>
      <input id={`${id}-w`} inputMode="decimal" value={width} onChange={(event) => setWidth(event.target.value)} />
      <label htmlFor={`${id}-h`}>Board height (mm)</label>
      <input id={`${id}-h`} inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} />
      <p role={problem ? "alert" : undefined}>{problem ?? "Written as <name>.circuit.tsx in the project folder; Undo removes it again."}</p>
      <button type="submit" disabled={busy}>
        Create
      </button>
    </form>
  )
}
