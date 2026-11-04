import { useCallback, useEffect, useMemo, useState } from "react"
import { api, hasToken, subscribe, type BuildState, type CircuitData, type Edit, type HistoryListing, type PartsData } from "./api"
import { UndoIcon } from "./icons"
import { Inspector } from "./Inspector"
import { LeftPanel } from "./LeftPanel"
import { PcbCanvas } from "./pcb/PcbCanvas"
import { SchematicPane } from "./SchematicPane"

/** Every action reports failures itself and resolves to whether it succeeded. */
export interface Actions {
  edit(edits: Edit[], summary: string): Promise<boolean>
  lock(parts: string[], locked: boolean): Promise<boolean>
  mark(text: string, at?: { view: "pcb" | "schematic"; x: number; y: number }): Promise<boolean>
  unmark(id: string): Promise<boolean>
  undo(id?: string): Promise<boolean>
  verify(id: string, by: string, against: string, confirm: string): Promise<boolean>
  notify(text: string): void
}

type Tab = "pcb" | "schematic"

/** Starting values for built-in parts tscircuit cannot build without, so a placed part builds at once. */
const PLACE_DEFAULTS: Record<string, Record<string, string>> = {
  resistor: { resistance: "10k", footprint: "0402" },
  capacitor: { capacitance: "100nF", footprint: "0402" },
  inductor: { inductance: "10uH", footprint: "0805" },
  led: { color: "red", footprint: "0603" },
  crystal: { frequency: "16MHz" },
  fuse: { currentRating: "500mA", footprint: "1206" },
}

export function App() {
  const [files, setFiles] = useState<string[]>([])
  const [file, setFile] = useState<string>()
  const [circuit, setCircuit] = useState<CircuitData>()
  const [build, setBuild] = useState<BuildState>({ status: "idle" })
  const [history, setHistory] = useState<HistoryListing[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("pcb")
  const [message, setMessage] = useState<string | null>(null)
  const [parts, setParts] = useState<PartsData>({ library: [], builtin: [] })

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

  const refreshParts = useCallback(async () => {
    setParts(await api<PartsData>("/api/parts"))
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
    refreshParts().catch((error: Error) => notify(error.message))
  }, [notify, refreshParts])

  useEffect(() => {
    if (!file) return
    setSelected(null)
    refresh(file).catch((error: Error) => notify(error.message))
    api("/api/build", { file })
      .then(() => refreshBuild(file))
      .catch((error: Error) => notify(error.message))
    return subscribe((event, changed) => {
      if (event === "library") {
        refreshParts().catch((error: Error) => notify(error.message))
        return
      }
      if (changed !== file) return
      const update = event === "change" ? refresh(file) : refreshBuild(file)
      update.catch((error: Error) => notify(error.message))
    })
  }, [file, refresh, refreshBuild, refreshParts, notify])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, select")
      if (event.key === "Escape" && !typing) setSelected(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

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

  // Memoised so panels can depend on it in effects without refetching on every render.
  const actions: Actions = useMemo(
    () => ({
      edit: (edits, summary) => run(() => api("/api/edit", { file, edits, summary })),
      lock: (parts, locked) => run(() => api("/api/lock", { file, parts, locked })),
      mark: (text, at) => run(() => api("/api/mark", { file, text, ...at })),
      unmark: (id) => run(() => api("/api/unmark", { file, id })),
      undo: (id) => run(() => api("/api/undo", id ? { id } : {})),
      verify: async (id, by, against, confirm) => {
        const ok = await run(() => api("/api/verify", { id, by, against, confirm }))
        if (ok) await refreshParts()
        return ok
      },
      notify,
    }),
    [file, run, notify, refreshParts],
  )

  const place = async (part: string) => {
    try {
      const props = PLACE_DEFAULTS[part]
      const result = await api<{ name: string }>("/api/place", { file, part, ...(props ? { props } : {}) })
      setSelected(result.name)
      notify(`Placed ${result.name}${props ? " with a starting value; change it on the right" : ""}. Drag it into position on the PCB.`)
    } catch (error) {
      notify((error as Error).message)
    } finally {
      if (file) await refresh(file).catch(() => undefined)
    }
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
      <header className="topbar">
        <div className="start">
          <span className="brand">copperflow</span>
          <select value={file ?? ""} onChange={(e) => setFile(e.target.value)} aria-label="Circuit file">
            {files.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
        <div className="views" role="tablist" aria-label="View">
          {(["schematic", "pcb"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "pcb" ? "PCB" : "Schematic"}
            </button>
          ))}
        </div>
        <div className="end">
          <span className={`build ${buildTone(build)}`} role="status">
            <span className="dot" aria-hidden="true" />
            {statusText(build)}
          </span>
          <button onClick={() => void actions.undo()} title="Undo the last change">
            <UndoIcon /> Undo
          </button>
        </div>
      </header>
      {circuit && circuit.violations.length > 0 && (
        <div className="banner" role="alert">
          Locked parts changed outside the editor: {circuit.violations.map((v) => `${v.part} (${v.detail})`).join(", ")}
        </div>
      )}
      <main className="workspace">
        {circuit && (
          <LeftPanel
            circuit={circuit}
            history={history}
            parts={parts}
            onPlace={(part) => void place(part)}
            selected={selected}
            onSelect={setSelected}
            actions={actions}
          />
        )}
        <section className="canvas">
          {!json && <p className="empty">{build.status === "failed" ? build.error : "Building the circuit…"}</p>}
          {json && circuit && tab === "pcb" && (
            <PcbCanvas
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
          <Inspector
            circuit={circuit}
            json={json}
            build={build}
            parts={parts}
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

function errorCount(build: BuildState): number {
  return build.report?.errors.reduce((sum, g) => sum + g.count, 0) ?? 0
}

function statusText(build: BuildState): string {
  if (build.status === "building") return "Building"
  if (build.status === "failed") return "Build failed"
  if (build.status !== "done" || !build.report) return "Not built"
  const errors = errorCount(build)
  return errors === 0 ? "Build OK" : `${errors} errors`
}

function buildTone(build: BuildState): "busy" | "bad" | "good" | "idle" {
  if (build.status === "building") return "busy"
  if (build.status === "failed" || errorCount(build) > 0) return "bad"
  return build.status === "done" ? "good" : "idle"
}
