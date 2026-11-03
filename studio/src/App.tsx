import { useCallback, useEffect, useState } from "react"
import { api, hasToken, subscribe, type BuildState, type CircuitData, type Edit, type HistoryListing } from "./api"
import { PcbPane } from "./PcbPane"
import { SchematicPane } from "./SchematicPane"
import { Sidebar } from "./Sidebar"

/** Every action reports failures itself and resolves to whether it succeeded. */
export interface Actions {
  edit(edits: Edit[], summary: string): Promise<boolean>
  lock(parts: string[], locked: boolean): Promise<boolean>
  mark(text: string, at?: { view: "pcb" | "schematic"; x: number; y: number }): Promise<boolean>
  unmark(id: string): Promise<boolean>
  undo(id?: string): Promise<boolean>
  notify(text: string): void
}

type Tab = "pcb" | "schematic"

export function App() {
  const [files, setFiles] = useState<string[]>([])
  const [file, setFile] = useState<string>()
  const [circuit, setCircuit] = useState<CircuitData>()
  const [build, setBuild] = useState<BuildState>({ status: "idle" })
  const [history, setHistory] = useState<HistoryListing[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("pcb")
  const [message, setMessage] = useState<string | null>(null)

  const notify = useCallback((text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage((current) => (current === text ? null : current)), 6000)
  }, [])

  const refresh = useCallback(async (target: string) => {
    const [data, entries] = await Promise.all([
      api<CircuitData>(`/api/circuit?file=${encodeURIComponent(target)}`),
      api<HistoryListing[]>("/api/history?limit=30"),
    ])
    setCircuit(data)
    setHistory(entries)
  }, [])

  const refreshBuild = useCallback(async (target: string) => {
    const next = await api<BuildState>(`/api/build?file=${encodeURIComponent(target)}`)
    // Keep the same circuit JSON object while a build runs, so the viewers do not reset.
    setBuild((previous) => (next.status === "building" && previous.circuitJson ? { ...next, circuitJson: previous.circuitJson } : next))
  }, [])

  useEffect(() => {
    api<string[]>("/api/circuits")
      .then((list) => {
        setFiles(list)
        setFile((current) => current ?? list[0])
      })
      .catch((error: Error) => notify(error.message))
  }, [notify])

  useEffect(() => {
    if (!file) return
    setSelected(null)
    refresh(file).catch((error: Error) => notify(error.message))
    api("/api/build", { file })
      .then(() => refreshBuild(file))
      .catch((error: Error) => notify(error.message))
    return subscribe((event, changed) => {
      if (changed !== file) return
      const update = event === "change" ? refresh(file) : refreshBuild(file)
      update.catch((error: Error) => notify(error.message))
    })
  }, [file, refresh, refreshBuild, notify])

  const run = useCallback(
    async (task: () => Promise<unknown>): Promise<boolean> => {
      try {
        await task()
        return true
      } catch (error) {
        notify((error as Error).message)
        return false
      } finally {
        if (file) await refresh(file).catch(() => undefined)
      }
    },
    [file, refresh, notify],
  )

  const actions: Actions = {
    edit: (edits, summary) => run(() => api("/api/edit", { file, edits, summary })),
    lock: (parts, locked) => run(() => api("/api/lock", { file, parts, locked })),
    mark: (text, at) => run(() => api("/api/mark", { file, text, ...at })),
    unmark: (id) => run(() => api("/api/unmark", { file, id })),
    undo: (id) => run(() => api("/api/undo", id ? { id } : {})),
    notify,
  }

  const json = build.circuitJson
  if (!hasToken) {
    return (
      <p className="empty">
        Open the address that <code>copperflow studio</code> printed in the terminal. It contains a key for this
        session.
      </p>
    )
  }
  return (
    <div className="app">
      <header>
        <strong className="brand">copperflow</strong>
        <select value={file ?? ""} onChange={(e) => setFile(e.target.value)} aria-label="Circuit file">
          {files.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <nav>
          {(["pcb", "schematic"] as const).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "pcb" ? "PCB" : "Schematic"}
            </button>
          ))}
        </nav>
        <span className={`status ${build.status}`}>{statusText(build)}</span>
        <button onClick={() => void actions.undo()}>Undo</button>
      </header>
      {circuit && circuit.violations.length > 0 && (
        <div className="banner">
          Locked parts changed outside the Studio: {circuit.violations.map((v) => `${v.part} (${v.detail})`).join(", ")}
        </div>
      )}
      <main>
        <section className="viewer">
          {!json && <p className="empty">{build.status === "failed" ? build.error : "Building the circuit…"}</p>}
          {json && circuit && tab === "pcb" && (
            <PcbPane
              json={json}
              buildId={build.finishedAt}
              circuit={circuit}
              actions={actions}
              selected={selected}
              onSelect={setSelected}
            />
          )}
          {json && circuit && tab === "schematic" && (
            <SchematicPane json={json} actions={actions} onSelect={setSelected} />
          )}
        </section>
        {circuit && (
          <Sidebar
            circuit={circuit}
            json={json}
            build={build}
            history={history}
            selected={selected}
            onSelect={setSelected}
            actions={actions}
          />
        )}
      </main>
      {message && (
        <div className="toast" role="status" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}
    </div>
  )
}

function statusText(build: BuildState): string {
  if (build.status === "building") return "Building…"
  if (build.status === "failed") return "Build failed"
  if (build.status !== "done" || !build.report) return ""
  const errors = build.report.errors.reduce((sum, g) => sum + g.count, 0)
  return errors === 0 ? "Build OK" : `${errors} build errors`
}
