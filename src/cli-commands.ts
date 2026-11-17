import { resolve } from "node:path"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  bomWithReport,
  exportFabrication,
  exportPackage,
  formatFabrication,
  formatBomCsv,
  formatBomMarkdown,
  listParts,
  placePart,
  readPart,
  rebuildComponents,
  verifyPart,
  addMark,
  checkCircuit,
  formatCheck,
  formatBoardImport,
  formatHistory,
  formatSummary,
  importBoard,
  listHistory,
  loadCircuit,
  lockParts,
  removeMark,
  undoChange,
  unlockParts,
  updateAnnotations,
  writeRender,
  type MarkInput,
  type Renderer,
} from "./core/index.js"
import type { DesignSource } from "./core/bom.js"
import { PIN_FORMATS, pinMapText, type PinFormat } from "./core/pin-map.js"
import { buildWith } from "./core/design-source.js"
import { Engine } from "./engine/engine.js"
import { formatImport, importLcscPart } from "./library/import-lcsc.js"
import { formatKicadImport, importKicad } from "./library/kicad/import.js"
import { createCopperflowServer } from "./mcp/server.js"
import { studioCommand } from "./cli-studio.js"
import { VERSION } from "./version.js"
import { installSkill } from "./skill-install.js"
import { modulesCommand } from "./cli-modules.js"
import { libraryCommand } from "./cli-library.js"
import { changeTarget, changeText, changeView } from "./core/change-view.js"

export interface CliIO {
  out(text: string): void
  err(text: string): void
  /** Asks the person at the terminal; absent when the CLI does not run in an interactive terminal. */
  ask?(question: string): Promise<string>
}

const HELP = `copperflow ${VERSION}

Usage:
  copperflow mcp                              start the MCP server on stdio
  copperflow studio [--port n] [--idle-minutes n]
                                              open the visual editor at http://127.0.0.1:4777 (or a free port);
                                              with --idle-minutes it stops after n minutes with no tab open
  copperflow studio stop                      stop the Studio of this folder
  copperflow skill [--global]                 copy the copperflow skills into .claude/skills of this folder
                                              (or of your home folder), for agents that read skills
  copperflow summary <file>                   print a circuit summary
  copperflow check <file>                     list the errors and warnings of copperflow's own rule checks
  copperflow lock <file> <part...>            lock parts so the agent cannot change them
  copperflow unlock <file> <part...>          unlock parts
  copperflow mark <file> <text> [--pcb x,y | --sch x,y]
                                              leave a note for the agent
  copperflow unmark <file> <id>               remove a note
  copperflow parts                            list the parts library
  copperflow parts build                      regenerate part components after editing part.yaml
  copperflow parts verify <id> --by <name> --against <datasheet, page>
                                              mark a part as checked against its datasheet
  copperflow parts import <C-number> [--id <id>] [--replace]
                                              fetch a part by its LCSC number from EasyEDA into parts/,
                                              not verified (needs the internet; see docs/licences.md)
  copperflow modules                          list the shelf of modules (COPPERFLOW_MODULES, default ~/.copperflow/modules)
  copperflow modules verify <name> --by <name>
                                              mark a module (or <library>/<name>) as checked by you
  copperflow modules remove <name>            take a module off the shelf
  copperflow library                          list the libraries of modules: built in, git and folders
  copperflow library add <name> <address or folder> [--ref <branch or tag>]
                                              add a library from git (https://, ssh:// or user@host:path)
                                              or a folder; its modules read NOT verified until you verify them
  copperflow library update [name]            bring git libraries to the newest commit of their ref
  copperflow library remove <name>            forget a library (a clone is deleted, a folder never)
  copperflow place <file> <part> <name> [key=value ...]
                                              add a library or built-in part to a circuit
  copperflow bom <file> [--csv]               print the bill of materials
  copperflow package <file> [--out dir]
                                              write BOM, datasheets, part status and pin maps to a folder
  copperflow pins <file> [--part <name>] [--format md|csv|c]
                                              which net is on each pin of the library chips and connectors
  copperflow export <file> [--out dir]        write the fabrication files for JLCPCB: Gerbers, drills,
                                              pick-and-place and BOM in <name>-fab/ and <name>-fab.zip
                                              beside the circuit (or in the project folder --out)
  copperflow render <file> [--view pcb|schematic] [--page <name>] [--parts U1,C3] [--width n] [--out file.png]
                                              draw the board or a schematic page to a PNG, as the Studio shows it
                                              (<name>-pcb.png or <name>-schematic-<page>.png beside the circuit)
  copperflow board <file> --dxf <path> [--layer <name>] [--units mm|inch] [--origin keep] [--replace]
                                              set the board's outline, holes and keepouts from a DXF drawing
  copperflow import kicad <board.kicad_pcb> [--name <circuit name>] [--replace] [--origin keep]
                                              make a new circuit from a KiCad board: its outline, parts (as
                                              library parts, not verified), nets, tracks, vias and pours
  copperflow history [--limit n]              list recent changes
  copperflow history <id> | --since <id>      what one change did, or everything after it
  copperflow undo [id]                        undo the newest change, or the given one

Every command accepts --root <dir> (default: the current directory).
check exits with 1 when the circuit has errors; export exits with 1 when the circuit has errors and writes nothing.`

export interface CliOptions {
  /** Builds the design for check, bom, package and export; tests pass one that runs in this process. */
  engine?: DesignSource
  /** Fetches for parts import; tests pass one that answers from fixtures. */
  fetch?: typeof fetch
  /** Loads the renderer for render; tests pass the source module. */
  renderer?: () => Promise<Renderer>
}

export async function runCli(args: string[], cwd: string, io: CliIO, options: CliOptions = {}): Promise<number> {
  const [rootOption, afterRoot] = takeOption(args, "--root")
  const root = resolve(cwd, rootOption ?? ".")
  const [command, ...rest] = afterRoot
  try {
    switch (command) {
      case "mcp": {
        // One engine for the whole session. A new one for each call starts a worker and loads the builder again,
        // which cost most of a second on every call that builds. It stops when the agent's program closes the pipe.
        const own = options.engine ? undefined : new Engine()
        if (own) for (const event of ["end", "close"] as const) process.stdin.once(event, () => void own.stop())
        await createCopperflowServer(root, own ? { ...options, engine: own } : options).connect(new StdioServerTransport())
        return 0
      }
      case "studio":
        io.out(await studioCommand(root, rest, takeOption))
        return 0
      case "skill":
        io.out(await installSkill({ cwd: root, global: rest.includes("--global") }))
        return 0
      case "summary":
        io.out(formatSummary(await loadCircuit(root, required(rest[0], "file"))))
        return 0
      case "check": {
        const file = required(rejectOldBuildOption(rest)[0], "file")
        const result = await checkCircuit(root, file, designOptions(options))
        io.out(formatCheck(file, result))
        return result.ok ? 0 : 1
      }
      case "lock":
      case "unlock":
        await changeLocks(root, command, rest, io)
        return 0
      case "mark":
        await mark(root, rest, io)
        return 0
      case "unmark":
        await updateAnnotations(root, required(rest[0], "file"), (a) => removeMark(a, required(rest[1], "mark id")))
        io.out(`Removed mark ${rest[1]}`)
        return 0
      case "history": {
        const [limit, afterLimit] = takeOption(rest, "--limit")
        const [since, args] = takeOption(afterLimit, "--since")
        const target = changeTarget(args[0], since)
        if (target) {
          io.out(changeText(await changeView(root, target, options.engine ? { engine: options.engine } : {})))
          return 0
        }
        const { entries, problems } = await listHistory(root, positiveInt(limit ?? "20"))
        io.out(formatHistory(entries, problems))
        return 0
      }
      case "parts":
        await partsCommand(root, rest, io, options)
        return 0
      case "modules":
        await modulesCommand(rest, io, takeOption)
        return 0
      case "library":
        await libraryCommand(root, rest, (text) => io.out(text), takeOption)
        return 0
      case "place": {
        const [file, part, name, ...props] = rest
        const request = { part: required(part, "part"), name: required(name, "name"), props: parseProps(props) }
        const result = await placePart(root, required(file, "file"), request, { author: "human" })
        io.out(`${result.entry.id}: ${result.entry.summary}`)
        return 0
      }
      case "bom": {
        const [csv, withoutCsv] = takeFlag(rest, "--csv")
        const file = required(rejectBuildFlag(withoutCsv)[0], "file")
        const { lines, report } = await bomWithReport(root, file, designOptions(options))
        io.out(csv ? formatBomCsv(lines) : `${formatBomMarkdown(lines)}\n${report}`)
        return 0
      }
      case "package": {
        const [outDir, args] = takeOption(rejectBuildFlag(rest), "--out")
        const file = required(args[0], "file")
        const result = await exportPackage(root, file, { ...designOptions(options), ...(outDir ? { outDir } : {}) })
        io.out(`Wrote ${result.outDir}:\n${result.files.join("\n")}`)
        return 0
      }
      case "pins": {
        const [part, afterPart] = takeOption(rest, "--part")
        const [format, args] = takeOption(afterPart, "--format")
        if (format !== undefined && !PIN_FORMATS.includes(format as PinFormat)) throw new Error(`--format takes ${PIN_FORMATS.join(", ")} (got ${format})`)
        const text = await pinMapText(root, required(args[0], "file"), { ...designOptions(options), ...(part ? { part } : {}), ...(format ? { format: format as PinFormat } : {}) })
        io.out(text)
        return 0
      }
      case "export": {
        const [outDir, args] = takeOption(rest, "--out")
        const result = await exportFabrication(root, required(args[0], "file"), { ...designOptions(options), ...(outDir ? { outDir } : {}) })
        io.out(formatFabrication(result))
        return result.written ? 0 : 1
      }
      case "render":
        io.out(await renderCommand(root, rest, options))
        return 0
      case "board":
        io.out(await boardCommand(root, rest, options))
        return 0
      case "import":
        io.out(await importCommand(cwd, root, rest, options))
        return 0
      case "undo": {
        // The built design tells which tracks start on locked parts, so copper can be undone while parts are locked.
        const design = (circuit: string) => buildWith(root, circuit, options.engine)
        const entry = await undoChange(root, { author: "human", design, ...(rest[0] ? { id: rest[0] } : {}) })
        io.out(`${entry.id}: ${entry.summary}`)
        return 0
      }
      case undefined:
      case "help":
      case "--help":
        io.out(HELP)
        return 0
      default:
        throw new Error(`Unknown command "${command}". Run "copperflow help".`)
    }
  } catch (error) {
    io.err(`copperflow: ${(error as Error).message}`)
    return 1
  }
}

async function boardCommand(root: string, rest: string[], options: CliOptions): Promise<string> {
  const [dxf, afterDxf] = takeOption(rest, "--dxf")
  const [layer, afterLayer] = takeOption(afterDxf, "--layer")
  const [units, afterUnits] = takeOption(afterLayer, "--units")
  const [origin, afterOrigin] = takeOption(afterUnits, "--origin")
  const [replace, args] = takeFlag(afterOrigin, "--replace")
  if (units !== undefined && units !== "mm" && units !== "inch") throw new Error(`--units must be mm or inch, not ${units}`)
  if (origin !== undefined && origin !== "keep") throw new Error(`--origin takes keep, not ${origin}`)
  const request = {
    dxf: required(dxf, "--dxf"),
    ...(layer !== undefined ? { layer } : {}),
    units: units === "inch" ? ("inch" as const) : units === "mm" ? ("mm" as const) : undefined,
    origin: origin === "keep" ? ("keep" as const) : undefined,
    replace,
  }
  const result = await importBoard(root, required(args[0], "file"), request, { author: "human", ...designOptions(options) })
  return formatBoardImport(result).join("\n")
}

const KICAD_USAGE = "Usage: copperflow import kicad <board.kicad_pcb> [--name <circuit name>] [--replace] [--origin keep]"

/** `import kicad <path>`: the path is read from where the command runs, as a person typed it. */
async function importCommand(cwd: string, root: string, rest: string[], options: CliOptions): Promise<string> {
  const [kind, ...args] = rest
  if (kind !== "kicad") throw new Error(`import reads kicad boards only. ${KICAD_USAGE}`)
  const [name, afterName] = takeOption(args, "--name")
  const [origin, afterOrigin] = takeOption(afterName, "--origin")
  const [replace, remaining] = takeFlag(afterOrigin, "--replace")
  if (origin !== undefined && origin !== "keep") throw new Error(`--origin takes keep, not ${origin}`)
  const unknown = remaining.find((arg) => arg.startsWith("-"))
  if (unknown) throw new Error(`Unknown option "${unknown}" for import kicad. ${KICAD_USAGE}`)
  if (remaining[0] === undefined) throw new Error(`Missing the KiCad board (.kicad_pcb). ${KICAD_USAGE}`)
  const request = { kicad: resolve(cwd, remaining[0]), replace, ...(name !== undefined ? { name } : {}), ...(origin === "keep" ? { origin: "keep" as const } : {}) }
  return formatKicadImport(await importKicad(root, request, { author: "human", caller: "cli", ...designOptions(options) })).join("\n")
}

async function renderCommand(root: string, rest: string[], options: CliOptions): Promise<string> {
  const [view, afterView] = takeOption(rest, "--view")
  const [page, afterPage] = takeOption(afterView, "--page")
  const [parts, afterParts] = takeOption(afterPage, "--parts")
  const [width, afterWidth] = takeOption(afterParts, "--width")
  const [out, args] = takeOption(afterWidth, "--out")
  if (view !== undefined && view !== "pcb" && view !== "schematic") throw new Error(`--view must be pcb or schematic, not ${view}`)
  const request = {
    view: view ?? "pcb",
    ...(page !== undefined ? { page } : {}),
    ...(parts !== undefined ? { parts: parts.split(",").map((name) => name.trim()).filter((name) => name !== "") } : {}),
    ...(width !== undefined ? { width: Number(width) } : {}),
  } as const
  const renderOptions = { ...designOptions(options), ...(options.renderer ? { renderer: options.renderer } : {}) }
  return writeRender(root, required(args[0], "file"), request, out, renderOptions)
}

async function changeLocks(root: string, command: "lock" | "unlock", rest: string[], io: CliIO): Promise<void> {
  const file = required(rest[0], "file")
  const parts = rest.slice(1)
  if (parts.length === 0) throw new Error(`Usage: copperflow ${command} <file> <part...>`)
  const { model } = await loadCircuit(root, file)
  await updateAnnotations(root, file, (a) =>
    command === "lock" ? lockParts(a, model, parts, new Date().toISOString()) : unlockParts(a, parts),
  )
  io.out(`${command === "lock" ? "Locked" : "Unlocked"} ${parts.join(", ")}`)
}

async function mark(root: string, rest: string[], io: CliIO): Promise<void> {
  const [pcb, withoutPcb] = takeOption(rest, "--pcb")
  const [sch, args] = takeOption(withoutPcb, "--sch")
  const file = required(args[0], "file")
  const text = required(args[1], "text")
  const position = pcb ?? sch
  const input: MarkInput = position
    ? { text, view: pcb ? "pcb" : "schematic", ...parsePosition(position) }
    : { text }
  let id = ""
  await updateAnnotations(root, file, (a) => {
    const result = addMark(a, input, new Date().toISOString())
    id = result.mark.id
    return result.annotations
  })
  io.out(`Added mark ${id}`)
}

const IMPORT_USAGE = "Usage: copperflow parts import <C-number> [--id <id>] [--replace]"

async function partsCommand(root: string, rest: string[], io: CliIO, options: CliOptions): Promise<void> {
  const [action, ...args] = rest
  if (action === undefined) {
    const parts = await listParts(root)
    if (parts.length === 0) {
      io.out("The parts library is empty. The agent creates parts with create_part.")
      return
    }
    for (const p of parts) {
      if (p.error) io.out(`${p.id}  ${p.error}`)
      else io.out(`${p.id}  <${p.component}>  ${p.title}  ${p.footprint}  ${p.verified ? `verified by ${p.verifiedBy}` : "not verified"}${p.origin ? `  ${p.origin}` : ""}`)
    }
    return
  }
  if (action === "build") {
    io.out((await rebuildComponents(root)).join("\n") || "No parts to build.")
    return
  }
  if (action === "import") {
    if (args.includes("--help") || args.includes("-h")) {
      io.out(IMPORT_USAGE)
      return
    }
    const [replace, withoutReplace] = takeFlag(args, "--replace")
    const [id, remaining] = takeOption(withoutReplace, "--id")
    const unknown = remaining.find((arg) => arg.startsWith("-"))
    if (unknown) throw new Error(`Unknown option "${unknown}" for parts import. ${IMPORT_USAGE}`)
    if (remaining.length > 1) throw new Error(`parts import takes one LCSC part number (got ${remaining.join(", ")}). ${IMPORT_USAGE}`)
    const lcsc = required(remaining[0], "LCSC part number (e.g. C7950)")
    const result = await importLcscPart(root, lcsc, { now: new Date().toISOString(), replace, ...(id ? { id } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) })
    io.out(formatImport(result))
    return
  }
  if (action === "verify") {
    const [by, withoutBy] = takeOption(args, "--by")
    const [against, remaining] = takeOption(withoutBy, "--against")
    const id = required(remaining[0], "part id")
    if (!by || !against) throw new Error('Usage: copperflow parts verify <id> --by "<name>" --against "<datasheet, revision, page>"')
    // A person confirms at a real terminal; an agent's shell is not interactive.
    if (!io.ask) throw new Error("parts verify must be run by a person in an interactive terminal")
    const part = await readPart(root, id)
    io.out(`${part.title}, ${part.mpn ?? "no MPN"}, footprint ${part.footprint}`)
    for (const [number, pin] of Object.entries(part.pins)) io.out(`  pin ${number}: ${pin.name} (${pin.type})`)
    const answer = await io.ask(`Type ${id} to confirm you checked all of this against the datasheet: `)
    if (answer.trim() !== id) throw new Error(`Not verified: you typed "${answer.trim()}", not ${id}`)
    await verifyPart(root, id, { by, against }, new Date().toISOString())
    io.out(`${id} is verified by ${by}`)
    return
  }
  throw new Error(`Unknown parts command "${action}". Run "copperflow help".`)
}

/** `key=value` arguments as literal props: numbers and true/false keep their type. */
function parseProps(args: string[]): Record<string, string | number | boolean> {
  return Object.fromEntries(
    args.map((arg) => {
      const split = arg.indexOf("=")
      if (split < 1) throw new Error(`Props look like key=value (got "${arg}")`)
      const [key, text] = [arg.slice(0, split), arg.slice(split + 1)]
      // Only text that reads back the same is a number: "0402" stays a footprint string.
      const asNumber = Number(text)
      const value = text !== "" && String(asNumber) === text ? asNumber : text === "true" ? true : text === "false" ? false : text
      return [key, value]
    }),
  )
}

/** The engine to build the design with, when one was given; otherwise the BOM starts its own. */
function designOptions(options: CliOptions): { engine?: DesignSource } {
  return options.engine ? { engine: options.engine } : {}
}

/** bom and package always read the design the engine builds from the code, so --build has nothing left to do. */
function rejectBuildFlag(args: string[]): string[] {
  if (args.includes("--build")) {
    throw new Error("--build is no longer an option: bom and package read the design the engine builds from the circuit code")
  }
  return args
}

/** check runs copperflow's own rules, so the old option that chose another build tool has nothing left to do. */
function rejectOldBuildOption(args: string[]): string[] {
  if (args.includes("--tsci")) throw new Error("--tsci is no longer an option: check runs copperflow's own rules")
  return args
}

function takeFlag(args: string[], name: string): [boolean, string[]] {
  return [args.includes(name), args.filter((arg) => arg !== name)]
}

/** Returns the value of `--name value` and the arguments without it. */
function takeOption(args: string[], name: string): [string | undefined, string[]] {
  const index = args.indexOf(name)
  if (index === -1) return [undefined, args]
  return [required(args[index + 1], `${name} value`), [...args.slice(0, index), ...args.slice(index + 2)]]
}

function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") throw new Error(`Missing ${what}. Run "copperflow help".`)
  return value
}

function parsePosition(text: string): { x: number; y: number } {
  const [x, y] = text.split(",").map(Number)
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`Position must look like 10,5 (got "${text}")`)
  }
  return { x, y }
}

function positiveInt(text: string): number {
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1) throw new Error(`--limit must be a positive whole number (got "${text}")`)
  return value
}
