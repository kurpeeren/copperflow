import { useEffect, useId, useState, type FormEvent } from "react"
import { designatorRows, instancePlaceholder, portRows, SHEET_NAME_HINT, type MakeSheetPreview } from "./make-sheet-form"

/** What Edit → Make sub-sheet… asks the server: what a name would make, and the change itself. */
export interface MakeSheetPanel {
  parts: readonly string[]
  preview(request: MakeSheetChoice): Promise<MakeSheetPreview>
  make(request: MakeSheetChoice): Promise<boolean>
}

/** What the dialog asks: the sheet's name, the instance's (empty for the default, <Sheet>1) and whether to rename. */
export interface MakeSheetChoice {
  name: string
  instance?: string
  rename: boolean
}

const PREVIEW_DELAY_MS = 200

/** The server's answer for the name and the rename choice as typed, asked again a moment after each change. */
function usePreview(panel: MakeSheetPanel, choice: MakeSheetChoice): { preview?: MakeSheetPreview; problem?: string } {
  const { name, instance, rename } = choice
  const [state, setState] = useState<{ preview?: MakeSheetPreview; problem?: string }>({ problem: SHEET_NAME_HINT })
  useEffect(() => {
    if (name.trim() === "") {
      setState({ problem: SHEET_NAME_HINT })
      return
    }
    let current = true
    const id = window.setTimeout(() => {
      panel.preview({ name: name.trim(), rename, ...(instance ? { instance } : {}) }).then(
        (preview) => current && setState({ preview }),
        (error: Error) => current && setState({ problem: error.message }),
      )
    }, PREVIEW_DELAY_MS)
    return () => {
      current = false
      window.clearTimeout(id)
    }
  }, [panel, name, instance, rename])
  return state
}

function Ports({ preview }: { preview: MakeSheetPreview }) {
  const rows = portRows(preview)
  if (rows.length === 0) return <p>No net crosses the selection, so the sheet has no ports.</p>
  return (
    <table aria-label="Ports">
      <tbody>
        {rows.map((row) => (
          <tr key={row.port}>
            <td>{row.port}</td>
            <td>{row.joins}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Designators({ preview }: { preview: MakeSheetPreview }) {
  return (
    <table aria-label="Designators">
      <thead>
        <tr>
          <td>Now</td>
          <td>In the sheet</td>
          <td>On the board</td>
        </tr>
      </thead>
      <tbody>
        {designatorRows(preview).map((row) => (
          <tr key={row.now}>
            <td>{row.now}</td>
            <td>{row.sheet}</td>
            <td>{row.board}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The sheet's name, what it will make (file, instance, ports, designators) and whether to rename the parts. */
export function MakeSheetForm({ panel, onClose }: { panel: MakeSheetPanel; onClose(): void }) {
  const [name, setName] = useState("")
  const [instanceText, setInstance] = useState("")
  const [rename, setRename] = useState(false)
  const instance = instanceText.trim()
  const choice = { name: name.trim(), rename, ...(instance ? { instance } : {}) }
  const { preview, problem } = usePreview(panel, choice)
  const id = useId()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (preview && (await panel.make(choice))) onClose()
  }
  return (
    <form className="rules-form make-sheet-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={id}>Sheet name</label>
      <input id={id} value={name} placeholder="PowerStage" onChange={(event) => setName(event.target.value)} aria-describedby={`${id}-note`} aria-invalid={problem !== undefined && name !== ""} />
      <label htmlFor={`${id}-instance`}>Instance name</label>
      <input id={`${id}-instance`} value={instanceText} placeholder={instancePlaceholder(name)} onChange={(event) => setInstance(event.target.value)} />
      <p id={`${id}-note`}>
        {preview ? `Writes ${preview.file}; ${preview.instance} (base ${preview.base}) takes the place of ${panel.parts.length} part${panel.parts.length === 1 ? "" : "s"}.` : problem}
      </p>
      {preview && (
        <>
          <h3>Ports</h3>
          <Ports preview={preview} />
          <h3>Designators</h3>
          <Designators preview={preview} />
        </>
      )}
      <label className="make-sheet-rename">
        <input type="checkbox" checked={rename} onChange={(event) => setRename(event.target.checked)} />
        Rename the parts to local designators (R1, C1, …)
      </label>
      <button type="submit" disabled={!preview}>
        Make sub-sheet
      </button>
    </form>
  )
}
