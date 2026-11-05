import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isPartVerified, libraryIds, libraryImports, PARTS_DIR, readPart, type Part } from "./library.js"
import type { PartInfo } from "./types.js"
import { loadCircuit, resolveInRoot } from "./workspace.js"

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
  verified?: boolean
}

/** Named elements that are not components and so never appear in a BOM. */
const NOT_COMPONENTS = new Set([
  "group",
  "subcircuit",
  "schematicsheet",
  "net",
  "netlabel",
  "port",
  "via",
  "hole",
  "platedhole",
  "smtpad",
  "copperpour",
  "cutout",
  "footprint",
  "constraint",
])
const VALUE_PROPS = ["resistance", "capacitance", "inductance", "frequency", "color", "voltage", "maxResistance", "standard"]
const COLUMNS = ["Designators", "Quantity", "Kind", "Value", "Footprint", "Manufacturer", "MPN", "Supplier part", "Datasheet"]

/**
 * Builds a BOM from the circuit source and the parts library. The last build's circuit JSON,
 * when given, fills in supplier part numbers that the parts engine chose.
 */
export async function buildBom(root: string, file: string, circuitJson?: unknown[]): Promise<BomLine[]> {
  const { model, file: circuitFile } = await loadCircuit(root, file)
  const library = libraryImports(model, circuitFile, await libraryIds(root))
  const parts = new Map<string, Part>()
  const verified = new Map<string, boolean>()
  for (const id of new Set(library.values())) {
    const part = await readPart(root, id)
    parts.set(id, part)
    verified.set(id, await isPartVerified(root, id, part))
  }

  const groups = new Map<string, BomLine>()
  for (const part of model.parts) {
    if (NOT_COMPONENTS.has(part.tag)) continue
    const libraryId = library.get(part.tag)
    const line = libraryId ? libraryLine(part, libraryId, parts.get(libraryId) as Part, verified.get(libraryId) === true) : builtinLine(part, circuitJson)
    // Every prop except names and positions, so ratings, tolerances and expressions keep lines apart.
    const props = Object.entries(part.props)
      .filter(([key]) => key !== "key" && !key.startsWith("pcb") && !key.startsWith("sch"))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, prop]) => `${key}=${prop.source}`)
    const key = JSON.stringify([part.tag, libraryId ?? "", line.verified ?? "", line.supplier, ...props])
    const existing = groups.get(key)
    groups.set(
      key,
      existing ? { ...existing, designators: [...existing.designators, part.name], quantity: existing.quantity + 1 } : line,
    )
  }
  const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true })
  return [...groups.values()]
    .map((line) => ({ ...line, designators: [...line.designators].sort(natural) }))
    .sort((a, b) => natural(a.designators[0] ?? "", b.designators[0] ?? ""))
}

function libraryLine(part: PartInfo, id: string, library: Part, verified: boolean): BomLine {
  const [supplier, number] = Object.entries(library.suppliers ?? {})[0] ?? []
  return {
    designators: [part.name],
    quantity: 1,
    kind: "chip",
    value: library.title,
    footprint: library.footprint,
    manufacturer: library.manufacturer ?? "",
    mpn: library.mpn ?? "",
    supplier: supplier ? `${supplier} ${number}` : "",
    datasheet: library.datasheet?.url ?? library.datasheet?.file ?? "",
    libraryPart: id,
    verified,
  }
}

function builtinLine(part: PartInfo, circuitJson: unknown[] | undefined): BomLine {
  const literal = (key: string) => {
    const value = part.props[key]?.literal
    return value === undefined ? "" : String(value)
  }
  const value = VALUE_PROPS.map(literal).find((v) => v !== "") ?? ""
  const built = (circuitJson ?? []).find(
    (e): e is { supplier_part_numbers?: Record<string, string[]>; manufacturer_part_number?: string } =>
      typeof e === "object" && e !== null && (e as { type?: unknown }).type === "source_component" && (e as { name?: unknown }).name === part.name,
  )
  const [supplier, numbers] = Object.entries(built?.supplier_part_numbers ?? {})[0] ?? []
  return {
    designators: [part.name],
    quantity: 1,
    kind: part.tag,
    value,
    footprint: literal("footprint"),
    manufacturer: "",
    mpn: built?.manufacturer_part_number ?? "",
    supplier: supplier && numbers?.[0] ? `${supplier} ${numbers[0]}` : "",
    datasheet: "",
  }
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
  options: { outDir?: string; circuitJson?: unknown[] } = {},
): Promise<{ outDir: string; files: string[] }> {
  const { file: circuitFile } = await loadCircuit(root, file)
  // The circuit's own path, so boards/a/main and boards/b/main do not share a folder.
  const outDir = (options.outDir ?? `exports/${circuitFile.replace(/\.circuit\.tsx$/, "")}`).split("\\").join("/")
  const outPath = resolveInRoot(root, outDir)
  const lines = await buildBom(root, file, options.circuitJson)
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
