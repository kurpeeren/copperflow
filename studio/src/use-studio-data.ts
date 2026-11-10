// What Studio loads from its server: the project's circuit files, the open file's circuit, build and history, and
// the parts; kept in step with the server's change events.
import { useCallback, useEffect, useState } from "react"
import { api, subscribe, type BuildState, type CircuitData, type HistoryListing, type HistoryProblem, type HistoryResult, type PartsData } from "./api"
import { isStaleKey } from "./request-error"

export interface StudioData {
  files: string[]
  /** The project's sub-sheet files, which open as their own schematic. */
  sheets: string[]
  /** The project folder's name, once the server has said it. */
  project: string | undefined
  file: string | undefined
  setFile(file: string): void
  circuit: CircuitData | undefined
  build: BuildState
  history: HistoryListing[]
  /** Entry files the history could not read, or why the whole listing failed; the canvas does not wait on it. */
  historyProblems: HistoryProblem[]
  parts: PartsData
  /** Reloads the circuit and the history of `file`. */
  refresh(file: string): Promise<void>
  refreshParts(): Promise<void>
}

/** The file list, the project name and the parts, once at start. */
function useProject(notify: (text: string) => void, setFile: (pick: (current: string | undefined) => string | undefined) => void, refreshParts: () => Promise<void>) {
  const [files, setFiles] = useState<string[]>([])
  const [sheets, setSheets] = useState<string[]>([])
  const [project, setProject] = useState<string>()
  useEffect(() => {
    api<string[]>("/api/circuits")
      .then((list) => {
        setFiles(list)
        setFile((current) => current ?? list[0])
      })
      .catch((error: Error) => notify(error.message))
    api<string[]>("/api/sheets")
      .then(setSheets)
      .catch((error: Error) => notify(error.message))
    api<{ name: string }>("/api/project")
      .then((info) => setProject(info.name))
      .catch((error: Error) => notify(error.message))
    refreshParts().catch((error: Error) => notify(error.message))
  }, [notify, setFile, refreshParts])
  return { files, sheets, project }
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
  const [historyProblems, setHistoryProblems] = useState<HistoryProblem[]>([])
  const [parts, setParts] = useState<PartsData>({ library: [], builtin: [] })
  // An out of date key stops every request, so the canvas says so instead of waiting for a build forever.
  const report = useCallback(
    (text: string) => {
      if (isStaleKey(text)) setBuild({ status: "failed", error: text })
      notify(text)
    },
    [notify],
  )

  const refresh = useCallback(async (target: string) => {
    // The history is a side panel: when it fails the document still shows, and the panel says why.
    const [data, listing] = await Promise.all([
      api<CircuitData>(`/api/circuit?file=${encodeURIComponent(target)}`),
      api<HistoryResult>("/api/history?limit=30").catch((error: Error): HistoryResult => ({ entries: [], problems: [{ file: "history", reason: error.message }] })),
    ])
    setCircuit(data)
    setHistory(listing.entries)
    setHistoryProblems(listing.problems)
  }, [])

  const refreshParts = useCallback(async () => {
    setParts(await api<PartsData>("/api/parts"))
  }, [])

  const refreshBuild = useCallback(async (target: string) => {
    const next = await api<BuildState>(`/api/build?file=${encodeURIComponent(target)}`)
    // Keep the same design object while a build runs, so the viewers do not redraw from scratch.
    setBuild((previous) => (next.status === "building" && previous.design ? { ...next, design: previous.design } : next))
  }, [])

  const { files, sheets, project } = useProject(report, setFile, refreshParts)

  useEffect(() => {
    if (!file) return
    onFile()
    refresh(file).catch((error: Error) => report(error.message))
    api("/api/build", { file })
      .then(() => refreshBuild(file))
      .catch((error: Error) => report(error.message))
    return subscribe((event, changed) => {
      if (event === "library") {
        refreshParts().catch((error: Error) => report(error.message))
        return
      }
      if (changed !== file) return
      const update = event === "change" ? refresh(file) : refreshBuild(file)
      update.catch((error: Error) => report(error.message))
    })
  }, [file, refresh, refreshBuild, refreshParts, report, onFile])

  return { files, sheets, project, file, setFile, circuit, build, history, historyProblems, parts, refresh, refreshParts }
}
