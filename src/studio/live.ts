import { watch, type FSWatcher } from "node:fs"
import { buildCircuit, reportFromElements, type CheckResult } from "../core/check.js"
import { FastBuildUnavailable } from "./evaluator.js"

export type BuildStatus = "idle" | "building" | "done" | "failed"

export interface BuildState {
  status: BuildStatus
  circuitJson?: unknown[]
  report?: CheckResult
  error?: string
  finishedAt?: string
}

/**
 * Builds a circuit faster than the tscircuit CLI; see evaluator.ts. It rejects with
 * FastBuildUnavailable when the CLI should build instead.
 */
export interface FastBuilder {
  evaluate(root: string, file: string): Promise<unknown[]>
}

export type Listener = (event: "change" | "build" | "library", data: Record<string, unknown>) => void

const IGNORED = /^(node_modules|dist|\.git|\.copperflow|coverage)\//
const ANNOTATIONS = /\.circuit\.annotations\.json$/
const PART_YAML = /^parts\/[^/]+\/part\.yaml$/
const LIBRARY_TIMER = "\0library"
const DEBOUNCE_MS = 150
const MAX_KEPT_BUILDS = 5

/**
 * Watches a project for circuit and annotation changes, tells listeners about them and keeps
 * one build per circuit up to date. Circuits are rebuilt on change once a build was requested.
 */
export class LiveProject {
  private readonly listeners = new Set<Listener>()
  private readonly builds = new Map<string, BuildState>()
  private readonly rerun = new Set<string>()
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private watcher: FSWatcher | undefined
  private stopped = false

  constructor(
    private readonly root: string,
    private readonly buildCommand?: string[],
    private readonly fast?: FastBuilder,
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

  requestBuild(file: string): void {
    const previous = this.getBuild(file)
    if (previous.status === "building") {
      this.rerun.add(file)
      return
    }
    this.builds.set(file, { ...previous, status: "building" })
    this.emit("build", { file, status: "building" })
    this.build(file)
      .then(({ result, circuitJson }) => this.finish(file, { status: "done", circuitJson, report: result }))
      .catch((error: Error) => this.finish(file, { ...this.getBuild(file), status: "failed", error: error.message }))
  }

  /**
   * The fast builder when there is one. A mistake in the circuit code fails the build at once;
   * the tscircuit CLI builds instead only when the fast builder cannot (see FastBuildUnavailable).
   */
  private async build(file: string): Promise<{ result: CheckResult; circuitJson: unknown[] }> {
    if (this.fast) {
      try {
        const circuitJson = await this.fast.evaluate(this.root, file)
        return { result: reportFromElements(circuitJson), circuitJson }
      } catch (error) {
        // The eval library appends its debug log after a blank line.
        const message = (error as Error).message.split("\n\n")[0] ?? ""
        if (!(error instanceof FastBuildUnavailable)) throw new Error(message)
        if (this.stopped) throw error
        console.error(`copperflow studio: building ${file} with tsci build: ${message.split("\n")[0]}`)
      }
    }
    return buildCircuit(this.root, file, this.buildCommand ? { command: this.buildCommand } : {})
  }

  private finish(file: string, state: BuildState): void {
    this.builds.delete(file)
    this.builds.set(file, { ...state, finishedAt: new Date().toISOString() })
    // Keep only the most recently built circuits; circuit JSON can be large.
    for (const [name, build] of this.builds) {
      if (this.builds.size <= MAX_KEPT_BUILDS) break
      if (build.status !== "building") this.builds.delete(name)
    }
    this.emit("build", { file, status: state.status })
    if (this.rerun.delete(file)) this.requestBuild(file)
  }

  private onFileEvent(name: string): void {
    if (IGNORED.test(name)) return
    if (PART_YAML.test(name)) {
      clearTimeout(this.timers.get(LIBRARY_TIMER))
      this.timers.set(
        LIBRARY_TIMER,
        setTimeout(() => {
          this.timers.delete(LIBRARY_TIMER)
          this.emit("library", {})
        }, DEBOUNCE_MS),
      )
      return
    }
    const file = ANNOTATIONS.test(name) ? name.replace(ANNOTATIONS, ".circuit.tsx") : name
    if (!file.endsWith(".circuit.tsx")) return
    clearTimeout(this.timers.get(file))
    this.timers.set(
      file,
      setTimeout(() => {
        this.timers.delete(file)
        this.emit("change", { file })
        if (this.builds.has(file) && file === name) this.requestBuild(file)
      }, DEBOUNCE_MS),
    )
  }

  private emit(event: "change" | "build" | "library", data: Record<string, unknown>): void {
    for (const listener of this.listeners) listener(event, data)
  }
}
