import { useCallback, useEffect, useState } from "react"
import { api } from "./api"
import { memoryView } from "./shell/project-memory"

/** The Project tab: PROJECT.md read-only, read again on Reload; edits go through the file. */
export function ProjectMemory() {
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string>()
  const load = useCallback(() => {
    api<{ text: string | null }>("/api/project-memory")
      .then((answer) => {
        setText(answer.text)
        setError(undefined)
      })
      .catch((failure: Error) => setError(failure.message))
  }, [])
  useEffect(load, [load])
  if (error) return <p className="note project-memory">PROJECT.md could not be read: {error}</p>
  if (text === undefined) return <p className="note project-memory">Reading PROJECT.md…</p>
  const view = memoryView(text)
  return (
    <div className="project-memory">
      <div className="project-memory-head">
        <h3>{view.kind === "file" ? view.title : "PROJECT.md"}</h3>
        <button type="button" onClick={load}>
          Reload
        </button>
      </div>
      {view.kind === "missing" && <p className="note">{view.note}</p>}
      {view.kind === "file" &&
        view.sections.map((section, index) => (
          <section key={`${section.title}-${index}`}>
            <h4>{section.title}</h4>
            {section.lines.length === 0 ? <p className="empty">(empty)</p> : <ul>{section.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>}
          </section>
        ))}
    </div>
  )
}
