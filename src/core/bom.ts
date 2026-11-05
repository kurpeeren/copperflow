import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Design } from "../engine/design.js"
import { Engine } from "../engine/engine.js"
import type { Component } from "../engine/model.js"
import { isPartVerified, libraryValues, PARTS_DIR, readPart, type Part } from "./library.js"
import { resolveCircuit, resolveInRoot } from "./workspace.js"

export interface BomLine {
  designators: string[]
  quantity: number
  kind: string
  value: string
  footprint: string
  manufacturer: string
  mpn: string
  /** e.g. "jlcpcb C25905" */
  supplier: string
  datasheet: string
  libraryPart?: string
  /** True when a person verified the library part and this instance keeps its footprint, MPN and supplier numbers. */
  verified?: boolean
}

const VALUE_PROPS = ["resistance", "capacitance", "inductance", "frequency", "color", "voltage", "maxResistance", "standard"]
const COLUMNS = ["Designators", "Quantity", "Kind", "Value", "Footprint", "Manufacturer", "MPN", "Supplier part", "Datasheet"]
/** Props that name or place a part, or hold its children; they never keep two parts on separate lines. */
const NON_IDENTITY_PROPS = new Set(["name", "key", "children"])

/** What the BOM needs from an engine: it builds one circuit file into a design. */
export type DesignSource = Pick<Engine, "build">

export interface BomOptions {
  /** A design that is already built; no engine is used. */
  design?: Design
  /** Builds the design when none is given. Without one, a new engine is started and stopped afterwards. */
  engine?: DesignSource
}

/** The given design, or one built by the given engine, or by a new engine that is stopped afterwards. */
async function designFor(root: string, file: string, options: BomOptions): Promise<Design> {
  if (options.design) return options.design
  if (options.engine) return options.engine.build(root, file)
  const engine = new Engine()
  try {
    return await engine.build(root, file)
  } finally {
    await engine.stop()
  }
}

/** Builds a BOM from the design of a circuit file and the parts library. */
export async function buildBom(root: string, file: string, options: BomOptions = {}): Promise<BomLine[]> {
  const { file: circuitFile } = await resolveCircuit(root, file)
  return bomFromDesign(root, await designFor(root, circuitFile, options))
}

async function bomFromDesign(root: string, design: Design): Promise<BomLine[]> {
  const library = await readLibraryParts(root, design)
  const groups = new Map<string, BomLine>()
  for (const component of design.circuit.components) {
    const entry = component.library ? library.get(component.library) : undefined
    const line = componentLine(component, entry)
    const key = JSON.stringify([component.kind, component.library ?? "", line.value, line.footprint, line.mpn, line.supplier, line.verified ?? "", identityProps(component)])
    const existing = groups.get(key)
    groups.set(key, existing ? { ...existing, designators: [...existing.designators, component.id], quantity: existing.quantity + 1 } : line)
  }
  const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true })
  return [...groups.values()]
    .map((line) => ({ ...line, designators: [...line.designators].sort(natural) }))
    .sort((a, b) => natural(a.designators[0] ?? "", b.designators[0] ?? ""))
}

interface LibraryEntry {
  part: Part
  verified: boolean
}

async function readLibraryParts(root: string, design: Design): Promise<Map<string, LibraryEntry>> {
  const entries = new Map<string, LibraryEntry>()
  for (const id of new Set(design.circuit.components.flatMap((c) => (c.library ? [c.library] : [])))) {
    const part = await readPart(root, id)
    entries.set(id, { part, verified: await isPartVerified(root, id, part) })
  }
  return entries
}

/** Every prop except names, positions and children, as JSON with sorted keys, so ratings and tolerances keep lines apart. */
function identityProps(component: Component): string {
  const entries = Object.entries(component.props)
    .filter(([key]) => !NON_IDENTITY_PROPS.has(key) && !key.startsWith("pcb") && !key.startsWith("sch"))
    .sort(([a], [b]) => (a < b ? -1 : 1))
  return JSON.stringify(entries)
}

function componentLine(component: Component, entry: LibraryEntry | undefined): BomLine {
  const part = entry?.part
  const [supplier, numbers] = Object.entries(component.supplierPartNumbers).find(([, list]) => list.length > 0) ?? []
  const [libSupplier, libNumber] = Object.entries(part?.suppliers ?? {})[0] ?? []
  return {
    designators: [component.id],
    quantity: 1,
    kind: component.kind,
    value: part?.title ?? component.value ?? propValue(component),
    footprint: component.footprint ?? part?.footprint ?? "",
    manufacturer: part?.manufacturer ?? "",
    mpn: component.mpn ?? part?.mpn ?? "",
    supplier: supplier && numbers?.[0] ? `${supplier} ${numbers[0]}` : libSupplier ? `${libSupplier} ${libNumber}` : "",
    datasheet: part?.datasheet?.url ?? part?.datasheet?.file ?? "",
    ...(component.library && entry ? { libraryPart: component.library, verified: entry.verified && keepsLibraryValues(component, component.library, entry.part) } : {}),
  }
}

/**
 * Whether an instance builds with the footprint, MPN and supplier numbers its library part sets. A
 * circuit can override them on the instance; the part a person verified is then not what is built.
 */
function keepsLibraryValues(component: Component, id: string, part: Part): boolean {
  const expected = libraryValues(id, part)
  const sorted = (numbers: Record<string, string[]>) => JSON.stringify(Object.entries(numbers).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return (
    component.footprint === expected.footprint &&
    component.mpn === expected.mpn &&
    sorted(component.supplierPartNumbers) === sorted(expected.supplierPartNumbers)
  )
}

/** The first of the props that give a part its value, e.g. an LED's color. */
function propValue(component: Component): string {
  for (const key of VALUE_PROPS) {
    const value = component.props[key]
    if (typeof value === "string" || typeof value === "number") return String(value)
  }
  return ""
}

export function formatBomCsv(lines: BomLine[]): string {
  const cell = (value: string | number) => {
    // A leading = + - @ makes spreadsheets run the cell as a formula.
    const text = /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const rows = lines.map((l) => [l.designators.join(" "), l.quantity, l.kind, l.value, l.footprint, l.manufacturer, l.mpn, l.supplier, l.datasheet])
  return [COLUMNS, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n"
}

export function formatBomMarkdown(lines: BomLine[]): string {
  const cell = (value: string | number) => String(value).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ")
  const rows = lines.map((l) => [l.designators.join(" "), l.quantity, l.kind, l.value, l.footprint, l.manufacturer, l.mpn, l.supplier, l.datasheet])
  return [
    `| ${COLUMNS.join(" | ")} |`,
    `| ${COLUMNS.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    "",
  ].join("\n")
}

/** Percent-encodes characters that would end a Markdown link or table cell, or start HTML. */
function markdownUrl(url: string): string {
  return url.replace(/[()[\]|<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)
}

/** Writes BOM.csv, BOM.md, README.md and copies of local datasheets into a folder in the project. */
export async function exportPackage(
  root: string,
  file: string,
  options: BomOptions & { outDir?: string } = {},
): Promise<{ outDir: string; files: string[] }> {
  const { file: circuitFile } = await resolveCircuit(root, file)
  // The circuit's own path, so boards/a/main and boards/b/main do not share a folder.
  const outDir = (options.outDir ?? `exports/${circuitFile.replace(/\.circuit\.tsx$/, "")}`).split("\\").join("/")
  const outPath = resolveInRoot(root, outDir)
  const lines = await bomFromDesign(root, await designFor(root, circuitFile, options))
  await rm(join(outPath, "datasheets"), { recursive: true, force: true })
  await mkdir(join(outPath, "datasheets"), { recursive: true })
  const files: string[] = []
  const write = async (name: string, text: string) => {
    await writeFile(join(outPath, name), text)
    files.push(`${outDir}/${name}`)
  }
  await write("BOM.csv", formatBomCsv(lines))
  await write("BOM.md", formatBomMarkdown(lines))

  const rows: string[] = []
  for (const line of lines.filter((l) => l.libraryPart)) {
    const id = line.libraryPart as string
    const library = await readPart(root, id)
    let link = library.datasheet?.url ? `[datasheet](${markdownUrl(library.datasheet.url)})` : "none"
    const local = library.datasheet?.file ? join(root, PARTS_DIR, id, library.datasheet.file) : undefined
    if (local && (await stat(local).catch(() => undefined))?.isFile()) {
      await copyFile(local, join(outPath, "datasheets", `${id}.pdf`))
      files.push(`${outDir}/datasheets/${id}.pdf`)
      link = `[datasheet](datasheets/${id}.pdf)`
    }
    rows.push(`| ${line.designators.join(" ")} | ${library.title.replace(/\|/g, "\\|")} | ${line.verified ? "verified" : "not verified"} | ${link} |`)
  }
  await write(
    "README.md",
    [
      `# ${circuitFile}`,
      "",
      "Library parts, their verification status and datasheets. Every part is in BOM.csv.",
      "",
      "| Designators | Part | Status | Datasheet |",
      "| --- | --- | --- | --- |",
      ...rows,
      "",
    ].join("\n"),
  )
  return { outDir, files }
}
