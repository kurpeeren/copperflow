// The Files tab of Project Design as plain functions: the tree built from the server's flat list, the rows the open
// folders show, the tree keys (Up/Down move, Right opens or enters, Left closes or goes to the parent, Enter acts), what
// a click does per kind, and each row's menu.
import type { FileEntry, FileKind, FileListing } from "../../../src/studio/file-list.js"
import { previewKind, type PreviewKind } from "../../../src/studio/file-kinds.js"
import { isSheetFile } from "../pcb/sheet-names.js"
import { NOT_IN_DESKTOP } from "./desktop-bridge.js"

export interface FileNode extends FileEntry {
  /** The last part of the path. */
  name: string
  /** A folder's entries in the server's order; empty for a file or a link. */
  children: FileNode[]
}

export interface FileTree {
  /** The project folder's own name, shown at the top. */
  name: string
  root: string
  nodes: FileNode[]
  truncated: boolean
}

export interface FileRow {
  node: FileNode
  /** 1 for the project's own entries, as aria-level counts. */
  depth: number
  /** The folder that holds the row, or undefined at the top level. */
  parent: string | undefined
  /** For a folder: whether it shows its children. */
  open: boolean
}

const parentOf = (path: string): string | undefined => {
  const slash = path.lastIndexOf("/")
  return slash < 0 ? undefined : path.slice(0, slash)
}

/** The project folder's last name, from a Windows or a POSIX path. */
export function rootName(root: string): string {
  return root.split(/[\\/]/).filter((part) => part !== "").pop() ?? root
}

/** The flat list (each folder before what it holds) as nested nodes, in the same order. */
export function buildFileTree(listing: FileListing): FileTree {
  const folders = new Map<string, FileNode>()
  const nodes: FileNode[] = []
  for (const entry of listing.entries) {
    const node: FileNode = { ...entry, name: entry.path.slice(entry.path.lastIndexOf("/") + 1), children: [] }
    const parent = parentOf(entry.path)
    // A parent the list cut off cannot be shown; its entry goes to the top level rather than nowhere.
    ;(parent === undefined ? nodes : (folders.get(parent)?.children ?? nodes)).push(node)
    if (entry.kind === "dir") folders.set(entry.path, node)
  }
  return { name: rootName(listing.root), root: listing.root, nodes, truncated: listing.truncated }
}

/** The rows the tree shows: every top-level entry, and the children of each open folder whose parents are open too. */
export function visibleRows(nodes: readonly FileNode[], open: ReadonlySet<string>, depth = 1, parent?: string): FileRow[] {
  return nodes.flatMap((node) => {
    const isOpen = node.kind === "dir" && open.has(node.path)
    const row: FileRow = { node, depth, parent, open: isOpen }
    return isOpen ? [row, ...visibleRows(node.children, open, depth + 1, node.path)] : [row]
  })
}

/** A new set with the folder opened or closed. */
export function toggleOpen(open: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(open)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

/** The open folders belong to one project: another root starts with every folder closed (.copperflow too). */
export interface OpenFolders {
  root: string
  open: ReadonlySet<string>
}

export function openForProject(state: OpenFolders, root: string): OpenFolders {
  return state.root === root ? state : { root, open: new Set() }
}

export type TreeMove = { focus: string } | { toggle: string } | { act: string } | null

/** What a key does on the focused row; null when the key is not the tree's. */
export function treeKey(key: string, rows: readonly FileRow[], focused: string): TreeMove {
  if (rows.length === 0) return null
  const at = rows.findIndex((row) => row.node.path === focused)
  const row = rows[at]
  // The focused row went away (the agent deleted it): the keys start again from the top.
  if (row === undefined) return isTreeKey(key) ? { focus: rows[0]!.node.path } : null
  const go = (index: number) => ({ focus: rows[Math.max(0, Math.min(rows.length - 1, index))]!.node.path })
  switch (key) {
    case "ArrowDown":
      return go(at + 1)
    case "ArrowUp":
      return go(at - 1)
    case "Home":
      return go(0)
    case "End":
      return go(rows.length - 1)
    case "ArrowRight":
      if (row.node.kind !== "dir") return null
      return row.open ? (rows[at + 1]?.parent === row.node.path ? go(at + 1) : null) : { toggle: row.node.path }
    case "ArrowLeft":
      if (row.open) return { toggle: row.node.path }
      return row.parent === undefined ? null : { focus: row.parent }
    case "Enter":
      return { act: row.node.path }
    default:
      return null
  }
}

const TREE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "ArrowRight", "ArrowLeft", "Enter"])
const isTreeKey = (key: string) => TREE_KEYS.has(key)

export type FileAction = { kind: "document"; file: string; view: "schematic" } | { kind: "preview"; preview: PreviewKind } | { kind: "toggle" } | { kind: "none" }

const CIRCUIT_FILE = /\.circuit\.tsx$/

/** What a click or Enter does: a circuit or sheet opens its schematic, a text or image kind the preview, a folder toggles. */
export function fileAction(entry: Pick<FileEntry, "path" | "kind">): FileAction {
  if (entry.kind === "dir") return { kind: "toggle" }
  // A link is listed, not followed: opening it could lead out of the project.
  if (entry.kind === "link") return { kind: "none" }
  if (CIRCUIT_FILE.test(entry.path) || isSheetFile(entry.path)) return { kind: "document", file: entry.path, view: "schematic" }
  const preview = previewKind(entry.path)
  return preview === undefined ? { kind: "none" } : { kind: "preview", preview }
}

export type FileIconKind =
  | "folder"
  | "link"
  | "file"
  | "circuit"
  | "sheet"
  | "layout"
  | "markdown"
  | "config"
  | "table"
  | "image"
  | "archive"
  | "web"
  | "model"
  | "gerber"
  | "drill"
  | "pdf"
  | "code"
  | "text"

const KIND_ICONS: Record<Exclude<FileKind, "file">, FileIconKind> = { dir: "folder", link: "link" }

/** A file's icon by its name, the first match winning: so a circuit is not taken for plain code, nor a layout for JSON. */
const BY_NAME: readonly (readonly [RegExp, FileIconKind])[] = [
  [/\.circuit\.tsx$/i, "circuit"],
  [/\.sheet\.tsx$/i, "sheet"],
  [/\.layout\.json$/i, "layout"],
  [/\.kicad_(pcb|sch|pro|mod)$/i, "layout"],
  [/\.(gtl|gbl|gts|gbs|gtp|gbp|gto|gbo|gm1|gko|gbr|g[1-9])$/i, "gerber"],
  [/\.(drl|xln)$/i, "drill"],
  [/\.(step|stp|glb|gltf|wrl|stl)$/i, "model"],
  [/\.(png|jpe?g|gif|webp|svg|bmp)$/i, "image"],
  [/\.md$/i, "markdown"],
  [/\.(ya?ml|json|toml)$/i, "config"],
  [/\.(csv|tsv)$/i, "table"],
  [/\.(zip|7z|gz|tgz|tar)$/i, "archive"],
  [/\.html?$/i, "web"],
  [/\.pdf$/i, "pdf"],
  [/\.(tsx?|jsx?|mjs|cjs)$/i, "code"],
  [/\.(txt|log)$/i, "text"],
]

export function fileIconKind(entry: Pick<FileEntry, "path" | "kind">): FileIconKind {
  if (entry.kind !== "file") return KIND_ICONS[entry.kind]
  return BY_NAME.find(([pattern]) => pattern.test(entry.path))?.[1] ?? "file"
}

export type FileMenuAction = "open" | "copy" | "show"

export interface FileMenuItem {
  label: string
  action: FileMenuAction
  /** Why the item cannot run here. */
  pending?: string
}

/** A row's menu: Open where a click opens something, Copy path, and Show in folder (the desktop app only). */
export function fileMenu(entry: Pick<FileEntry, "path" | "kind">, inDesktop: boolean): FileMenuItem[] {
  const opens = ["document", "preview"].includes(fileAction(entry).kind)
  return [
    ...(opens ? [{ label: "Open", action: "open" as const }] : []),
    { label: "Copy path", action: "copy" },
    { label: "Show in folder", action: "show", ...(inDesktop ? {} : { pending: NOT_IN_DESKTOP }) },
  ]
}

/** The entry's absolute path, with the separator the root uses (a Windows root has backslashes). */
export function absolutePath(root: string, path: string): string {
  const separator = root.includes("\\") ? "\\" : "/"
  const base = root.endsWith(separator) ? root.slice(0, -1) : root
  return [base, ...path.split("/")].join(separator)
}

const KILO = 1024

/** A size as the row's hover text shows it. */
/** Prose (Markdown, plain text) reads best wrapped; data files keep their lines, so columns stay in line. */
export function wrapsLines(path: string): boolean {
  return /\.(md|txt)$/i.test(path)
}

export function formatSize(bytes: number): string {
  if (bytes < KILO) return `${bytes} B`
  if (bytes < KILO * KILO) return `${(bytes / KILO).toFixed(1)} kB`
  return `${(bytes / KILO / KILO).toFixed(1)} MB`
}
