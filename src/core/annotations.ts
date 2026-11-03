import { readFile } from "node:fs/promises"
import { z } from "zod"
import { writeFileAtomic } from "./fs-utils.js"
import type { CircuitModel } from "./types.js"

const LockSchema = z.object({
  part: z.string(),
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

export function lockParts(annotations: Annotations, model: CircuitModel, parts: string[], now: string): Annotations {
  const fresh = parts.map((name): Lock => {
    const part = model.parts.find((p) => p.name === name)
    if (!part) throw new Error(`No part named ${name}`)
    const props = Object.fromEntries(Object.entries(part.props).map(([key, prop]) => [key, prop.source]))
    return { part: name, props, lockedAt: now }
  })
  const kept = annotations.locks.filter((lock) => !parts.includes(lock.part))
  return { ...annotations, locks: [...kept, ...fresh] }
}

export function unlockParts(annotations: Annotations, parts: string[]): Annotations {
  return { ...annotations, locks: annotations.locks.filter((lock) => !parts.includes(lock.part)) }
}

/** Finds locked parts that were removed or changed, for example by a direct file edit. */
export function verifyLocks(annotations: Annotations, model: CircuitModel): LockViolation[] {
  return annotations.locks.flatMap((lock): LockViolation[] => {
    const part = model.parts.find((p) => p.name === lock.part)
    if (!part) return [{ part: lock.part, kind: "missing", detail: "the locked part is no longer in the file" }]
    const keys = new Set([...Object.keys(lock.props), ...Object.keys(part.props)])
    const changes = [...keys].flatMap((key) => {
      const before = lock.props[key]
      const after = part.props[key]?.source
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
