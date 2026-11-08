// What Studio loads from its server: the project's circuit files, the open file's circuit, build and history, and
// the parts; kept in step with the server's change events.
import { useCallback, useEffect, useState } from "react"
import { api, subscribe, type BuildState, type CircuitData, type HistoryListing, type PartsData } from "./api"

export interface StudioData {
  files: string[]
  /** The project folder's name, once the server has said it. */
  project: string | undefined
  file: string | undefined
  setFile(file: string): void
  circuit: CircuitData | undefined
  build: BuildState
  history: HistoryListing[]
  parts: PartsData
  /** Reloads the circuit and the history of `file`. */
  refresh(file: string): Promise<void>
  refreshParts(): Promise<void>
}

/** The file list, the project name and the parts, once at start. */
function useProject(notify: (text: string) => void, setFile: (pick: (current: string | undefined) => string | undefined) => void, refreshParts: () => Promise<void>) {
  const [files, setFiles] = useState<string[]>([])
  const [project, setProject] = useState<string>()
  useEffect(() => {
    api<string[]>("/api/circuits")
      .then((list) => {
        setFiles(list)
        setFile((current) => current ?? list[0])
      })
      .catch((error: Error) => notify(error.message))
    api<{ name: string }>("/api/project")
      .then((info) => setProject(info.name))
      .catch((error: Error) => notify(error.message))
    refreshParts().catch((error: Error) => notify(error.message))
  }, [notify, setFile, refreshParts])
  return { files, project }
}

/**
 * Loads everything the editor shows and follows the server's events. `onFile` runs when another file opens, so the
 * caller can drop the selection and the highlight; both callbacks must be stable.
 */
export function useStudioData(notify: (text: string) => void, onFile: () => void): StudioData {
  const [file, setFile] = useState<string>()
  const [circuit, setCircuit] = useState<CircuitData>()
  const [build, setBuild] = useState<BuildState>({ status: "idle" })
  const [history, setHistory] = useState<HistoryListing[]>([])
  const [parts, setParts] = useState<PartsData>({ library: [], builtin: [] })

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
    // Keep the same design object while a build runs, so the viewers do not redraw from scratch.
    setBuild((previous) => (next.status === "building" && previous.design ? { ...next, design: previous.design } : next))
  }, [])

  const { files, project } = useProject(notify, setFile, refreshParts)

  useEffect(() => {
    if (!file) return
    onFile()
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
  }, [file, refresh, refreshBuild, refreshParts, notify, onFile])

  return { files, project, file, setFile, circuit, build, history, parts, refresh, refreshParts }
}
