// Design → Annotate designators as one change: the circuit file's renameParts edit (rename-parts.ts) and, when the
// circuit has a layout file, its copper's nets renamed with it, in one history entry (the layout file is its `also`).
// An unnamed net's id is "net:" and its first pin (src/engine/nets.ts), so a swap R1 ↔ R3 changes which pin comes
// first; the new id is worked out from the nets of the design built before the rename, so every track, via and pour
// keeps the copper it was drawn for. Named nets keep their names. The design also gives the designators that sub-sheet
// instances bring in (R101 from a sheet at base 100), which a new name may not take.
import type { Design } from "../engine/design.js"
import type { Net } from "../engine/model.js"
import { sortedNatural } from "../engine/order.js"
import { buildWith, type DesignSource } from "./design-source.js"
import { applyEdits } from "./edit.js"
import { EditError } from "./edit-error.js"
import { inProjectQueue, readIfThere, writeWithHistory } from "./file-writes.js"
import { assertMeta, type Author, type FileChange, type HistoryEntry } from "./history.js"
import { layoutPathFor, readLayoutText, serializeLayout } from "./layout-file.js"
import { renameRecordNets } from "./sheet-cut-layout.js"
import { alsoField, sheetFilesFirst } from "./sheet-files.js"
import { loadCircuit, resolveInRoot } from "./workspace.js"

export type RenameMapping = readonly { from: string; to: string }[]

const partOf = (pin: string): string => pin.split(".")[0] ?? pin

/** Each unnamed net's old id and the id it takes once its parts are renamed, for the nets whose id changes. */
export function renamedNetIds(nets: readonly Pick<Net, "id" | "names" | "pins">[], mapping: RenameMapping): Record<string, string> {
  const names = new Map(mapping.map(({ from, to }) => [from, to]))
  const pin = (id: string) => {
    const to = names.get(partOf(id))
    return to === undefined ? id : `${to}${id.slice(partOf(id).length)}`
  }
  const renamed: Record<string, string> = {}
  for (const net of nets) {
    if (net.names.length > 0 || !net.id.startsWith("net:")) continue
    const first = sortedNatural(net.pins.map(pin))[0]
    if (first !== undefined && `net:${first}` !== net.id) renamed[net.id] = `net:${first}`
  }
  return renamed
}

/** A record's net as it reads after the rename: an unnamed net's new id; named nets and other ids stay. */
export function netRenamer(nets: readonly Pick<Net, "id" | "names" | "pins">[], mapping: RenameMapping): (net: string) => string {
  const renamed = renamedNetIds(nets, mapping)
  const names = new Map(mapping.map(({ from, to }) => [from, to]))
  const known = new Set(nets.map((net) => net.id))
  return (net) => {
    if (Object.hasOwn(renamed, net)) return renamed[net] as string
    // An id the design lacks names a pin on no net of its own ("net:R3.pin2"): it follows that pin.
    const pin = /^net:([A-Za-z_]\w*)(\.[\w-]+)$/.exec(net)
    const to = pin && !known.has(net) ? names.get(pin[1] as string) : undefined
    return to === undefined ? net : `net:${to}${pin?.[2] ?? ""}`
  }
}

/** Refuses a new name that a sub-sheet instance's part already has in the built design. */
function refuseInstanceDesignators(design: Pick<Design, "circuit">, mapping: RenameMapping, ownParts: ReadonlySet<string>): void {
  const flattened = new Set(design.circuit.components.map((component) => component.id).filter((id) => !ownParts.has(id)))
  const clash = mapping.find(({ to }) => flattened.has(to))
  if (clash) throw new EditError("invalid", `${clash.to} is the designator of a part inside a sub-sheet instance; ${clash.from} cannot take it`)
}

/** The layout file's change, or none when the circuit has no layout file or no record names a renamed net. */
async function layoutChange(root: string, circuitFile: string, rename: (net: string) => string): Promise<FileChange[]> {
  if (!circuitFile.endsWith(".circuit.tsx")) return []
  const file = layoutPathFor(circuitFile)
  const before = await readIfThere(resolveInRoot(root, file))
  if (before === undefined) return []
  const doc = readLayoutText(before, file)
  const { records, changed } = renameRecordNets(doc.records, rename)
  return changed ? [{ file, before, after: serializeLayout({ ...doc, records }) }] : []
}

/**
 * Renames parts as one history entry naming the circuit file, with the layout file as its `also` when its copper
 * names nets the rename changes. The circuit is built first (with `meta.engine`, else a new engine) for its nets and
 * its instances' designators. Throws EditError for a refused rename; nothing is written then.
 */
export function renameDesignators(root: string, file: string, mapping: RenameMapping, meta: { author: Author; summary: string; engine?: DesignSource }): Promise<{ entry: HistoryEntry }> {
  return inProjectQueue(root, async () => {
    assertMeta(meta)
    if (mapping.length === 0) throw new EditError("invalid", "Nothing to rename")
    const loaded = await loadCircuit(root, file)
    const design = await buildWith(root, loaded.file, meta.engine)
    refuseInstanceDesignators(design, mapping, new Set(loaded.model.parts.map((part) => part.name)))
    const nets = renamedNetIds(design.circuit.nets, mapping)
    const locked = new Set(loaded.annotations.locks.map((lock) => lock.part))
    const after = applyEdits(loaded.source, [{ kind: "renameParts", mapping: [...mapping], nets }], locked)
    const also = await layoutChange(root, loaded.file, netRenamer(design.circuit.nets, mapping))
    const entry = await sheetFilesFirst(root, also, "after", () =>
      writeWithHistory(root, loaded, after, { author: meta.author, summary: meta.summary, file: loaded.file, before: loaded.source, after, ...alsoField(also) }),
    )
    return { entry }
  })
}
