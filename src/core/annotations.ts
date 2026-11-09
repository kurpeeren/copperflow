import { readFile } from "node:fs/promises"
import { z } from "zod"
import { writeFileAtomic } from "./fs-utils.js"
import type { CircuitModel, PropInfo } from "./types.js"

const LockSchema = z.object({
  /** A part's name, or a drawing's id. */
  part: z.string(),
  /** Set when the lock is on a drawing. */
  drawing: z.literal(true).optional(),
  /** Attribute source text of every prop at lock time. */
  props: z.record(z.string(), z.string()),
  lockedAt: z.string(),
})

const MarkSchema = z.object({
  id: z.string(),
  text: z.string(),
  view: z.enum(["pcb", "schematic"]).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  createdAt: z.string(),
})

const AnnotationsSchema = z.object({
  version: z.literal(1),
  locks: z.array(LockSchema),
  marks: z.array(MarkSchema),
})

export type Lock = z.infer<typeof LockSchema>
export type Mark = z.infer<typeof MarkSchema>
export type Annotations = z.infer<typeof AnnotationsSchema>
export type MarkInput = Pick<Mark, "text" | "view" | "x" | "y">

export interface LockViolation {
  part: string
  kind: "missing" | "changed"
  detail: string
}

export function emptyAnnotations(): Annotations {
  return { version: 1, locks: [], marks: [] }
}

/** `board.circuit.tsx` keeps its locks and marks in `board.circuit.annotations.json`. */
export function annotationsPathFor(circuitPath: string): string {
  return `${circuitPath.replace(/\.tsx$/, "")}.annotations.json`
}

/**
 * What a lock holds on to: the part with this name, or the drawing with this id. `kind` says which a lock is on, so
 * a lock on a part never matches a drawing of the same name; without it (a new lock), a part comes first.
 */
export function lockTarget(
  model: CircuitModel,
  name: string,
  kind?: "part" | "drawing",
): { props: Record<string, PropInfo>; drawing: boolean } | undefined {
  const part = kind === "drawing" ? undefined : model.parts.find((p) => p.name === name)
  if (part) return { props: part.props, drawing: false }
  const drawing = kind === "part" ? undefined : model.drawings.find((d) => d.id === name)
  return drawing && { props: drawing.props, drawing: true }
}

/** Which a stored lock is on. */
export function lockKind(lock: Lock): "part" | "drawing" {
  return lock.drawing ? "drawing" : "part"
}

/** Locks parts by name and drawings by id, with a snapshot of their props. */
export function lockParts(annotations: Annotations, model: CircuitModel, parts: string[], now: string): Annotations {
  const fresh = parts.map((name): Lock => {
    const target = lockTarget(model, name)
    if (!target) throw new Error(`No part or drawing named ${name}`)
    const props = Object.fromEntries(Object.entries(target.props).map(([key, prop]) => [key, prop.source]))
    return { part: name, ...(target.drawing ? { drawing: true as const } : {}), props, lockedAt: now }
  })
  const kept = annotations.locks.filter((lock) => !parts.includes(lock.part))
  return { ...annotations, locks: [...kept, ...fresh] }
}

export function unlockParts(annotations: Annotations, parts: string[]): Annotations {
  return { ...annotations, locks: annotations.locks.filter((lock) => !parts.includes(lock.part)) }
}

/** Finds locked parts and drawings that were removed or changed, for example by a direct file edit. */
export function verifyLocks(annotations: Annotations, model: CircuitModel): LockViolation[] {
  return annotations.locks.flatMap((lock): LockViolation[] => {
    const target = lockTarget(model, lock.part, lockKind(lock))
    if (!target) return [{ part: lock.part, kind: "missing", detail: `the locked ${lockKind(lock)} is no longer in the file` }]
    const keys = new Set([...Object.keys(lock.props), ...Object.keys(target.props)])
    const changes = [...keys].flatMap((key) => {
      const before = lock.props[key]
      const after = target.props[key]?.source
      return before === after ? [] : [`${key} was ${before ?? "(absent)"}, now ${after ?? "(absent)"}`]
    })
    return changes.length === 0 ? [] : [{ part: lock.part, kind: "changed", detail: changes.join("; ") }]
  })
}

export function addMark(annotations: Annotations, input: MarkInput, now: string): { annotations: Annotations; mark: Mark } {
  const highest = Math.max(0, ...annotations.marks.map((m) => Number(/^m(\d+)$/.exec(m.id)?.[1] ?? 0)))
  const mark: Mark = {
    id: `m${highest + 1}`,
    text: input.text,
    ...(input.view ? { view: input.view } : {}),
    ...(input.x !== undefined ? { x: input.x } : {}),
    ...(input.y !== undefined ? { y: input.y } : {}),
    createdAt: now,
  }
  return { annotations: { ...annotations, marks: [...annotations.marks, mark] }, mark }
}

export function removeMark(annotations: Annotations, id: string): Annotations {
  if (!annotations.marks.some((m) => m.id === id)) throw new Error(`No mark with id ${id}`)
  return { ...annotations, marks: annotations.marks.filter((m) => m.id !== id) }
}

export async function readAnnotations(path: string): Promise<Annotations> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAnnotations()
    throw error
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${(error as Error).message})`)
  }
  const parsed = AnnotationsSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`${path} is not a valid annotations file (${issues})`)
  }
  return parsed.data
}

export async function writeAnnotations(path: string, annotations: Annotations): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(annotations, null, 2)}\n`)
}
