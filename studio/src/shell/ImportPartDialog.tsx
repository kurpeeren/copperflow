import { useId, useState, type FormEvent } from "react"
import { importSummary, LCSC_HINT, readImportRequest, verifyHint, type ImportPartRequest, type ImportPartResult } from "./import-part-form"

/** What Library → Import by LCSC number… asks the server; `import` throws with the server's message. */
export interface ImportPartPanel {
  import(request: ImportPartRequest): Promise<ImportPartResult>
}

function Result({ result }: { result: ImportPartResult }) {
  return (
    <div className="import-result" role="status">
      <p>
        <strong>{importSummary(result)}</strong>
      </p>
      <p>{verifyHint(result)}</p>
      {result.notes.length > 0 && (
        <>
          <h3>Check these too</h3>
          <ul>
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
      <h3>Written</h3>
      <ul>
        {result.files.map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
      <p>{result.terms}</p>
    </div>
  )
}

/** The LCSC number, an optional part id and replace; the result, or the reason nothing was written. */
export function ImportPartForm({ panel, onClose }: { panel: ImportPartPanel; onClose(): void }) {
  const [lcsc, setLcsc] = useState("")
  const [id, setId] = useState("")
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [result, setResult] = useState<ImportPartResult>()
  const field = useId()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (result) return onClose()
    const request = readImportRequest(lcsc, id, replace)
    if ("message" in request) return setProblem(request.message)
    setBusy(true)
    setProblem(undefined)
    try {
      setResult(await panel.import(request))
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="rules-form import-part-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={field}>LCSC part number</label>
      <input id={field} value={lcsc} placeholder="C7950" disabled={busy || result !== undefined} onChange={(event) => setLcsc(event.target.value)} aria-describedby={`${field}-note`} aria-invalid={problem !== undefined} />
      <label htmlFor={`${field}-id`}>Part id</label>
      <input id={`${field}-id`} value={id} placeholder="the MPN" disabled={busy || result !== undefined} onChange={(event) => setId(event.target.value)} />
      <label className="make-sheet-rename">
        <input type="checkbox" checked={replace} disabled={busy || result !== undefined} onChange={(event) => setReplace(event.target.checked)} />
        Replace a part with this id that is not verified
      </label>
      <p id={`${field}-note`} role={problem ? "alert" : undefined}>
        {busy ? "Fetching from EasyEDA…" : (problem ?? (result ? "" : LCSC_HINT))}
      </p>
      {result && <Result result={result} />}
      <button type="submit" disabled={busy}>
        {result ? "Close" : "Import"}
      </button>
    </form>
  )
}
