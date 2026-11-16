// What Studio loads from its server: the project's circuit files, the open file's circuit, build and history, and
// the parts; kept in step with the server's change events.
import { useCallback, useEffect, useState } from "react"
import { api, subscribe, type BuildState, type CircuitData, type HistoryListing, type HistoryProblem, type HistoryResult, type PartsData, type PlaceEvent, type RouteEvent } from "./api"
import { isRouting, routeProgressText, writtenMark } from "../../src/studio/route-events.js"
import { isPlacing, placedMark, placeProgressText } from "../../src/studio/place-events.js"
import { announceHistoryWrite } from "./history-writes"
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
  /** The open circuit's latest Route → Autoroute news, from this Studio or another viewer's run. */
  route: RouteEvent | undefined
  /** The open circuit's latest Place → Autoplace news. */
  place: PlaceEvent | undefined
  /** True while the server's event stream cannot connect: the Studio server process has stopped. */
  serverGone: boolean
  /** Reloads the circuit and the history of `file`. */
  refresh(file: string): Promise<void>
  refreshParts(): Promise<void>
  /** Reads the project's circuit files again. */
  refreshFiles(): Promise<void>
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
  /** Reads the file list again, as after File → New circuit. */
  const refreshFiles = useCallback(() => api<string[]>("/api/circuits").then(setFiles), [])
  return { files, sheets, project, refreshFiles }
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
  const [route, setRoute] = useState<RouteEvent>()
  const [place, setPlace] = useState<PlaceEvent>()
  const [serverGone, setServerGone] = useState(false)
  const onConnection = useCallback((connected: boolean) => setServerGone(!connected), [])
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

  const { files, sheets, project, refreshFiles } = useProject(report, setFile, refreshParts)
  /** A run's news: kept for the status line and the Checks list; its end is told, and a write reloads the history. */
  const onRoute = useCallback(
    (event: RouteEvent) => {
      setRoute(event)
      if (isRouting(event)) return
      notify(routeProgressText(event))
      const mark = writtenMark(event)
      if (mark === undefined) return
      // The canvas keys wait for the build that holds the copper, as they do after an undo.
      void announceHistoryWrite(Promise.resolve({ ok: true, mark }))
      refresh(event.file).catch((error: Error) => report(error.message))
    },
    [notify, refresh, report],
  )

  /** A placement's news: its end is told, and a write is announced as an undo is, so the canvas waits for it. */
  const onPlace = useCallback(
    (event: PlaceEvent) => {
      setPlace(event)
      if (isPlacing(event)) return
      notify(placeProgressText(event))
      const mark = placedMark(event)
      if (mark === undefined) return
      void announceHistoryWrite(Promise.resolve({ ok: true, mark }))
      refresh(event.file).catch((error: Error) => report(error.message))
    },
    [notify, refresh, report],
  )

  useEffect(() => {
    if (!file) return
    onFile()
    setRoute(undefined)
    setPlace(undefined)
    refresh(file).catch((error: Error) => report(error.message))
    api("/api/build", { file })
      .then(() => refreshBuild(file))
      .catch((error: Error) => report(error.message))
    return subscribe((event, changed, data) => {
      if (event === "library") {
        refreshParts().catch((error: Error) => report(error.message))
        return
      }
      if (changed !== file) return
      if (event === "route") return onRoute(data as unknown as RouteEvent)
      if (event === "place") return onPlace(data as unknown as PlaceEvent)
      const update = event === "change" ? refresh(file) : refreshBuild(file)
      update.catch((error: Error) => report(error.message))
    }, onConnection)
  }, [file, refresh, refreshBuild, refreshParts, report, onFile, onRoute, onPlace, onConnection])

  return { files, sheets, project, file, setFile, circuit, build, history, historyProblems, parts, route, place, serverGone, refresh, refreshParts, refreshFiles }
}
