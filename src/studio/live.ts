import { watch, type FSWatcher } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Design } from "../engine/design.js"
import { FOOTPRINT_FILE } from "../engine/engine.js"
import { isProjectFile } from "../engine/project-files.js"

export type BuildStatus = "idle" | "building" | "done" | "failed"

/** Builds one circuit file of a project. The Studio uses the engine; `file` is a path inside `root`. */
export interface DesignBuilder {
  build(root: string, file: string): Promise<Design>
}

export interface BuildState {
  status: BuildStatus
  /** The last design that built. A failed build keeps it, so the viewers still have something to draw. */
  design?: Design
  error?: string
  /**
   * When the last finished build started; it holds every change made before then. While a build
   * runs, this and `finishedAt` still describe the last finished one.
   */
  startedAt?: string
  finishedAt?: string
}

export type Listener = (event: "change" | "build" | "library", data: Record<string, unknown>) => void

const IGNORED = /^(node_modules|dist|\.git|\.copperflow|coverage)\//
const ANNOTATIONS = /\.circuit\.annotations\.json$/
const PART_YAML = /^parts\/[^/]+\/part\.yaml$/
const LIBRARY_TIMER = "\0library"
const REBUILD_TIMER = "\0rebuild"
const BUILT_CIRCUIT_TIMER = "\0built:"
const DEBOUNCE_MS = 50
const MAX_KEPT_BUILDS = 5

/** What a kept build started from: the circuit text, and how many changes to the files the engine reads came before it. */
interface BuildStart {
  text: string | undefined
  changes: number
}

/**
 * Watches a project for circuit and annotation changes, tells listeners about them and keeps
 * one build per circuit up to date. Once a circuit was built, a change to any file the engine
 * reads (circuit code, imported modules, part components, footprint files) builds it again.
 */
export class LiveProject {
  private readonly listeners = new Set<Listener>()
  private readonly builds = new Map<string, BuildState>()
  /** What each kept build started from, so a watcher event for a circuit text already built is skipped. */
  private readonly starts = new Map<string, BuildStart>()
  /** How many changes to files the engine reads the watcher has seen. */
  private changes = 0
  private readonly rerun = new Set<string>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private watcher: FSWatcher | undefined
  private stopped = false
  private lastFinished = 0

  constructor(
    private readonly root: string,
    private readonly builder: DesignBuilder,
  ) {}

  start(): void {
    this.watcher = watch(this.root, { recursive: true }, (_event, name) => {
      if (name) this.onFileEvent(name.toString().split("\\").join("/"))
    })
    // Without a listener a watcher error (e.g. inotify limits on Linux) would crash the process.
    this.watcher.on("error", (error) => {
      console.error("copperflow studio: stopped watching files:", error.message)
      this.watcher?.close()
    })
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getBuild(file: string): BuildState {
    return this.builds.get(file) ?? { status: "idle" }
  }

  /**
   * The design of the last finished build of `file`, when neither the circuit file nor any other
   * file the engine reads has changed since that build started; otherwise nothing.
   */
  async currentDesign(file: string): Promise<Design | undefined> {
    const { status, design } = this.getBuild(file)
    const start = this.starts.get(file)
    if (status !== "done" || !design || start?.changes !== this.changes) return undefined
    const text = await this.readSource(file)
    return text !== undefined && text === start.text ? design : undefined
  }

  /** Builds `file` now, or once more after the build that is running. */
  requestBuild(file: string): void {
    if (this.stopped) return
    const previous = this.getBuild(file)
    if (previous.status === "building") {
      this.rerun.add(file)
      return
    }
    this.builds.set(file, { ...previous, status: "building" })
    this.emit("build", { file, status: "building" })
    void this.run(file, new Date().toISOString())
  }

  private async run(file: string, startedAt: string): Promise<void> {
    let next: BuildState
    try {
      const changes = this.changes
      this.starts.set(file, { text: await this.readSource(file), changes })
      next = { status: "done", design: await this.builder.build(this.root, file) }
    } catch (error) {
      const { design } = this.getBuild(file)
      const message = (error instanceof Error ? error.message : String(error)).split(this.root).join(".")
      next = { status: "failed", ...(design ? { design } : {}), error: message }
    }
    this.finish(file, { ...next, startedAt })
  }

  private finish(file: string, state: BuildState): void {
    if (this.stopped) return
    // Strictly later than the last build, so the browser always sees a new build as new.
    this.lastFinished = Math.max(Date.now(), this.lastFinished + 1)
    this.builds.delete(file)
    this.builds.set(file, { ...state, finishedAt: new Date(this.lastFinished).toISOString() })
    // Keep only the most recently built circuits; a design can be large.
    for (const [name, build] of this.builds) {
      if (this.builds.size <= MAX_KEPT_BUILDS) break
      if (build.status === "building") continue
      this.builds.delete(name)
      this.starts.delete(name)
    }
    this.emit("build", { file, status: state.status })
    if (this.rerun.delete(file)) this.requestBuild(file)
  }

  private readSource(file: string): Promise<string | undefined> {
    return readFile(join(this.root, file), "utf8").catch(() => undefined)
  }

  private onFileEvent(name: string): void {
    if (IGNORED.test(name)) return
    if (PART_YAML.test(name)) this.debounce(LIBRARY_TIMER, () => this.emit("library", {}))
    const annotations = ANNOTATIONS.test(name)
    const circuit = annotations ? name.replace(ANNOTATIONS, ".circuit.tsx") : name
    if (circuit.endsWith(".circuit.tsx")) this.debounce(circuit, () => this.emit("change", { file: circuit }))
    // The sidecar holds locks and marks, which the engine does not build from.
    if (annotations || !isProjectFile(name, FOOTPRINT_FILE)) return
    if (this.starts.has(name)) this.debounce(`${BUILT_CIRCUIT_TIMER}${name}`, () => void this.changedUnlessBuilt(name))
    else this.engineFileChanged()
  }

  /** The Studio builds its own edits at once; the watcher then sees the text that build started from and does nothing. */
  private async changedUnlessBuilt(file: string): Promise<void> {
    const text = await this.readSource(file)
    if (text === undefined || text !== this.starts.get(file)?.text) this.engineFileChanged()
  }

  /**
   * A file the engine reads changed: every kept build is stale from now on, and every circuit that
   * was built is built again once the changes settle. The engine writes nothing into the project,
   * so a build never causes another.
   */
  private engineFileChanged(): void {
    this.changes += 1
    this.debounce(REBUILD_TIMER, () => {
      for (const file of [...this.builds.keys()]) this.requestBuild(file)
    })
  }

  private debounce(key: string, task: () => void): void {
    clearTimeout(this.timers.get(key))
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        task()
      }, DEBOUNCE_MS),
    )
  }

  private emit(event: "change" | "build" | "library", data: Record<string, unknown>): void {
    for (const listener of this.listeners) listener(event, data)
  }
}
