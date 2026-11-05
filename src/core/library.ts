import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, stat } from "node:fs/promises"
import { join, posix } from "node:path"
import { parse, stringify } from "yaml"
import { z } from "zod"
import { writeFileAtomic } from "./fs-utils.js"
import type { CircuitModel } from "./types.js"

export const PARTS_DIR = "parts"

export const PIN_TYPES = ["power_in", "power_out", "ground", "input", "output", "bidirectional", "passive", "no_connect"] as const
export type PinType = (typeof PIN_TYPES)[number]

/** Props a library part owns; circuits cannot override them on an instance. */
export const LIBRARY_OWNED_PROPS = ["footprint", "manufacturerPartNumber", "supplierPartNumbers", "pinLabels", "pinAttributes"]

/** tscircuit pin attributes for each electrical pin type. */
export const PIN_ATTRIBUTES: Record<PinType, Record<string, boolean>> = {
  power_in: { requiresPower: true },
  power_out: { providesPower: true },
  ground: { requiresGround: true },
  input: { isInput: true },
  output: { isOutput: true },
  bidirectional: { isBidirectional: true },
  passive: { isPassive: true },
  no_connect: { doNotConnect: true },
}

// Ends with a letter or digit: Windows ignores trailing dots, so "Foo." could alias "Foo".
const PART_ID = /^[A-Za-z](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"])

const line = (max: number) =>
  z.string().max(max).regex(/^[^\x00-\x1f\x7f]*$/, "must be one line without control characters")

const PinSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "use letters, digits and _ (pin names become selectors)"),
    type: z.enum(PIN_TYPES),
    description: line(200).optional(),
  })
  .strict()

export const PartSchema = z
  .object({
    title: line(200).min(1),
    description: z.string().max(2000).regex(/^[^\x00-\x08\x0b-\x1f\x7f]*$/, "no control characters").optional(),
    manufacturer: line(200).optional(),
    mpn: line(100).optional(),
    footprint: z.string().regex(/^[A-Za-z0-9_.(),-]+$/, "use a tscircuit footprint string such as sot23_5"),
    pins: z.record(z.string().regex(/^[1-9][0-9]*$/, "pin numbers start at 1"), PinSchema),
    suppliers: z
      .record(z.string().regex(/^[a-z0-9_]+$/).refine((key) => !RESERVED_KEYS.has(key), "reserved name"), line(100))
      .optional(),
    datasheet: z
      .object({
        file: z.string().regex(/^[\w.-]+\.pdf$/i, "a PDF file name inside the part folder").optional(),
        url: z.url({ protocol: /^https?$/ }).optional(),
      })
      .strict()
      .optional(),
    verified: z
      .object({ by: line(100).min(1), against: line(300).min(1), date: z.string(), hash: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict()

export type Part = z.infer<typeof PartSchema>

export interface PartSummary {
  id: string
  title: string
  mpn?: string
  footprint: string
  component: string
  verified: boolean
  verifiedBy?: string
  /** Set when part.yaml cannot be read; the part is listed so the problem is visible. */
  error?: string
}

/** The exported component name for a part id: AP2112K-3.3 becomes AP2112K_3_3, ldo becomes Ldo. */
export function componentName(id: string): string {
  const base = id.replace(/[^A-Za-z0-9]/g, "_")
  return base.charAt(0).toUpperCase() + base.slice(1)
}

export function validatePartId(id: string): string {
  if (!PART_ID.test(id) || id.includes("..")) {
    throw new Error(`"${id}" is not a valid part id: start with a letter, end with a letter or digit, and use letters, digits, ".", "_" or "-"`)
  }
  return id
}

export function partDir(root: string, id: string): string {
  return join(root, PARTS_DIR, validatePartId(id))
}

/** A hash of everything in part.yaml except the verification itself. */
export function contentHash(part: Part): string {
  const { verified: _verified, ...content } = part
  return createHash("sha256").update(stableJson(content)).digest("hex")
}

/** Verified means a person checked exactly this content; any later change voids it. */
export function isVerified(part: Part): boolean {
  return part.verified?.hash === contentHash(part)
}

/** Part ids exactly as their folders are named, for folders that hold a part.yaml. */
export async function libraryIds(root: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(join(root, PARTS_DIR))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const ids: string[] = []
  for (const name of names.sort()) {
    if (PART_ID.test(name) && (await exists(join(root, PARTS_DIR, name, "part.yaml")))) ids.push(name)
  }
  return ids
}

export async function listParts(root: string): Promise<PartSummary[]> {
  const summaries: PartSummary[] = []
  for (const id of await libraryIds(root)) {
    try {
      const part = await readPart(root, id)
      summaries.push({
        id,
        title: part.title,
        ...(part.mpn ? { mpn: part.mpn } : {}),
        footprint: part.footprint,
        component: componentName(id),
        verified: isVerified(part),
        ...(isVerified(part) && part.verified ? { verifiedBy: part.verified.by } : {}),
      })
    } catch (error) {
      summaries.push({ id, title: "(invalid part.yaml)", footprint: "", component: componentName(id), verified: false, error: (error as Error).message })
    }
  }
  return summaries
}

export async function readPart(root: string, id: string): Promise<Part> {
  const path = join(partDir(root, id), "part.yaml")
  return parsePart(await readFile(path, "utf8"), `${PARTS_DIR}/${id}/part.yaml`)
}

/** Maps component names imported from the parts library to their part ids. */
export function libraryImports(model: CircuitModel, circuitFile: string, ids: readonly string[]): Map<string, string> {
  const found = new Map<string, string>()
  for (const entry of model.imports) {
    const target = posix.normalize(posix.join(posix.dirname(circuitFile), entry.source)).replace(/\.tsx?$/, "")
    const match = new RegExp(`^${PARTS_DIR}/([^/]+)/[^/]+$`).exec(target)
    if (match?.[1] && ids.includes(match[1])) found.set(entry.local, match[1])
  }
  return found
}

/**
 * Writes a part from data the agent read from a datasheet: part.yaml, the generated component
 * and a fresh verification checklist. New parts are not verified. A verified part cannot be replaced.
 */
export async function createPart(
  root: string,
  id: string,
  input: unknown,
  options: { replace?: boolean; now: string },
): Promise<{ part: Part; files: string[] }> {
  const dir = partDir(root, id)
  const { verified: _ignored, ...data } = validate(input, "part")
  const others = (await libraryIds(root)).filter((other) => other !== id)
  const clash = others.find((other) => other.toLowerCase() === id.toLowerCase() || componentName(other) === componentName(id))
  if (clash) throw new Error(`Part id "${id}" collides with the existing part "${clash}"; choose another id`)
  const yamlPath = join(dir, "part.yaml")
  if (await exists(yamlPath)) {
    if (!options.replace) throw new Error(`Part ${id} already exists; pass replace to overwrite it`)
    if (isVerified(await readPart(root, id))) throw new Error(`Part ${id} is verified; only a human can change it`)
  }
  await mkdir(dir, { recursive: true })
  await writeFileAtomic(yamlPath, stringify(data))
  await writeFileAtomic(join(dir, `${componentName(id)}.tsx`), generateComponent(id, data))
  // Always rewritten, so the checklist describes the pins that are actually in part.yaml.
  await writeFileAtomic(join(dir, "verification.md"), verificationTemplate(id, data))
  return {
    part: data,
    files: [`${PARTS_DIR}/${id}/part.yaml`, `${PARTS_DIR}/${id}/${componentName(id)}.tsx`, `${PARTS_DIR}/${id}/verification.md`],
  }
}

/** Marks the current content of a part as checked by a person. Only the CLI and the Studio call this. */
export async function verifyPart(root: string, id: string, check: { by: string; against: string }, now: string): Promise<Part> {
  const current = await readPart(root, id)
  const part: Part = { ...current, verified: { by: check.by, against: check.against, date: now, hash: contentHash(current) } }
  await writeFileAtomic(join(partDir(root, id), "part.yaml"), stringify(validate(part, `${id}/part.yaml`)))
  return part
}

/** Regenerates every component file from its part.yaml, after part.yaml was edited by hand. */
export async function rebuildComponents(root: string): Promise<string[]> {
  const written: string[] = []
  for (const { id, component, error } of await listParts(root)) {
    if (error) continue
    await writeFileAtomic(join(partDir(root, id), `${component}.tsx`), generateComponent(id, await readPart(root, id)))
    written.push(`${PARTS_DIR}/${id}/${component}.tsx`)
  }
  return written
}

/** The tscircuit component for a part. Values are written with JSON.stringify, so they stay literals. */
export function generateComponent(id: string, part: Part): string {
  const pins = Object.entries(part.pins).sort(([a], [b]) => Number(a) - Number(b))
  const labels = Object.fromEntries(pins.map(([number, pin]) => [`pin${number}`, pin.name]))
  const attributes = Object.fromEntries(pins.map(([number, pin]) => [`pin${number}`, PIN_ATTRIBUTES[pin.type]]))
  const suppliers = part.suppliers
    ? Object.fromEntries(Object.entries(part.suppliers).map(([supplier, number]) => [supplier, [number]]))
    : undefined
  const props = [
    `footprint={${JSON.stringify(part.footprint)}}`,
    part.mpn ? `manufacturerPartNumber={${JSON.stringify(part.mpn)}}` : undefined,
    suppliers ? `supplierPartNumbers={${JSON.stringify(suppliers)}}` : undefined,
    `pinLabels={${JSON.stringify(labels)}}`,
    `pinAttributes={${JSON.stringify(attributes)}}`,
    "{...props}",
  ].filter((entry): entry is string => entry !== undefined)
  return [
    `// Generated by copperflow from parts/${id}/part.yaml. Edit part.yaml, then run: copperflow parts build`,
    `export const ${componentName(id)} = (props: { name: string; [prop: string]: unknown }) => (`,
    "  <chip",
    ...props.map((entry) => `    ${entry}`),
    "  />",
    ")",
    "",
  ].join("\n")
}

export function verificationTemplate(id: string, part: Part): string {
  const pins = Object.entries(part.pins).sort(([a], [b]) => Number(a) - Number(b))
  return [
    `# Verification of ${part.title}`,
    "",
    "Status: not verified",
    `Content: ${contentHash(part).slice(0, 12)} (changes when part.yaml changes)`,
    "",
    "Check each item against the datasheet and write the page next to it. When everything is",
    `checked, run in a terminal: copperflow parts verify ${id} --by "<your name>" --against "<datasheet, revision, page>"`,
    "",
    ...pins.map(([number, pin]) => `- [ ] Pin ${number} is ${pin.name} (${pin.type.replace("_", " ")})`),
    `- [ ] Footprint ${part.footprint} matches the package drawing`,
    ...Object.entries(part.suppliers ?? {}).map(([supplier, number]) => `- [ ] ${supplier} part ${number} is this exact part`),
    "",
  ].join("\n")
}

function parsePart(text: string, label: string): Part {
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    throw new Error(`${label} is not valid YAML (${(error as Error).message.split("\n")[0]})`)
  }
  return validate(data, label)
}

function validate(data: unknown, label: string): Part {
  const parsed = PartSchema.safeParse(data)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Invalid ${label}: ${issues}`)
  }
  return parsed.data
}

/** JSON with object keys sorted, so equal content always hashes the same. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}
