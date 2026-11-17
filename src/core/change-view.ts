// One change, or everything since one, made ready to show: the project's files around it, each circuit it wrote built on
// both sides (on request only, one build at a time), what changed between them, and the lines that say it.
import { Engine } from "../engine/engine.js"
import type { Design } from "../engine/design.js"
import { diffDesigns, type BuiltSide, type DesignDiff } from "../engine/design-diff.js"
import { naturalCompare } from "../engine/order.js"
import { changeFiles, type ChangeTarget } from "./change-files.js"
import { bodyLines, cappedLines, changeTitle, fileCounts, fileLine, type ChangeLine, type FileCount } from "./change-words.js"
import type { DesignSource } from "./design-source.js"
import type { HistoryEntry } from "./history.js"
import { circuitPathFor, isLayoutFile } from "./layout-file.js"

const CIRCUIT = /\.circuit\.tsx$/

/** What builds a design from given files: the engine the caller already has. */
export type FilesBuilder = Required<Pick<DesignSource, "buildFiles">>

export interface CircuitChange {
  file: string
  before: BuiltSide
  after: BuiltSide
  diff: DesignDiff
}

export interface ChangeView {
  title: string
  entries: Omit<HistoryEntry, "before" | "after" | "also">[]
  circuits: CircuitChange[]
  lines: ChangeLine[]
  /** The files whose text differs, and by how many lines. */
  files: FileCount[]
}

export interface ChangeViewOptions {
  /** Builds the designs; without one, an engine is started for the two builds and stopped. */
  engine?: Partial<FilesBuilder>
  /** Only this circuit, instead of every circuit the changes wrote. */
  file?: string
}

/** The circuit a written file builds: itself, or the circuit beside a layout file. */
const circuitOf = (file: string): string | undefined => (isLayoutFile(file) ? circuitPathFor(file) : CIRCUIT.test(file) ? file : undefined)

function circuitsOf(entries: readonly HistoryEntry[]): string[] {
  const files = entries.flatMap((entry) => [entry.file, ...(entry.also ?? []).map((change) => change.file)])
  return [...new Set(files.flatMap((file) => circuitOf(file) ?? []))].sort(naturalCompare)
}

async function buildSide(build: (files: Record<string, string>, main: string) => Promise<Design>, files: Record<string, string>, file: string): Promise<BuiltSide> {
  if (files[file] === undefined) return { error: `there was no ${file}` }
  try {
    return { design: await build(files, file) }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

/** Calls `use` with a builder: the given engine's, or a new engine's that is stopped afterwards. */
async function withBuilder<T>(engine: Partial<FilesBuilder> | undefined, use: (build: FilesBuilder["buildFiles"]) => Promise<T>): Promise<T> {
  if (engine?.buildFiles) return use(engine.buildFiles.bind(engine))
  const own = new Engine()
  try {
    return await use((files, main) => own.buildFiles(files, main))
  } finally {
    await own.stop()
  }
}

/** Builds each circuit before and after, one build at a time, and says what changed. Refuses an id the history lacks. */
export async function changeView(root: string, target: ChangeTarget, options: ChangeViewOptions = {}): Promise<ChangeView> {
  if ("id" in target && "since" in target) throw new Error("Give id or since, not both")
  const around = await changeFiles(root, target)
  const entries = around.entries.map(({ before: _b, after: _a, also: _also, ...rest }) => rest)
  const circuits = options.file !== undefined ? [options.file] : circuitsOf(around.entries)
  const files = fileCounts(around.before.files, around.after.files, around.changed)
  const unsure = [...new Set([...around.before.unsure, ...around.after.unsure])].sort(naturalCompare)
  const built = await withBuilder(options.engine, async (build) => {
    const done: CircuitChange[] = []
    for (const file of circuits) {
      const before = await buildSide(build, around.before.files, file)
      const after = await buildSide(build, around.after.files, file)
      done.push({ file, before, after, diff: diffDesigns(before, after) })
    }
    return done
  })
  const title = changeTitle(target, entries)
  const body =
    built.length === 0
      ? [...unsure.map((file): ChangeLine => ({ kind: "unsure", text: `Not sure of ${file}: it was edited by hand between changes` })), { kind: "note" as const, text: "No circuit was changed" }, ...files.map(fileLine)]
      : built.flatMap((one, index) => [
          ...(built.length > 1 ? [{ kind: "note" as const, text: `In ${one.file}:` }] : []),
          ...bodyLines(one.diff, index === 0 ? unsure : [], index === 0 ? files : []),
        ])
  return { title, entries, circuits: built, lines: cappedLines(title, body), files }
}

/** One change (`id`), everything after one (`since`), or neither; both is refused. */
export function changeTarget(id: string | undefined, since: string | undefined): ChangeTarget | undefined {
  if (id !== undefined && since !== undefined) throw new Error("Give id or since, not both")
  return id !== undefined ? { id } : since !== undefined ? { since } : undefined
}

/** The lines as the agent and the CLI print them. */
export const changeText = (view: Pick<ChangeView, "lines">): string => view.lines.map((line) => line.text).join("\n")
