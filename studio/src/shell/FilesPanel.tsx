// The Files tab of Project Design: the project folder as a tree that reads itself again on every "files" event, so it
// follows what the agent writes. What the tree shows, the keys and what a click does are files-tree.ts.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react"
import { api, subscribe } from "../api"
import type { FileListing } from "../../../src/studio/file-list.js"
import type { PreviewKind } from "../../../src/studio/file-kinds.js"
import type { Point } from "../pcb/geometry"
import { ChevronIcon } from "../icons"
import { ContextMenu } from "./ContextMenu"
import { desktopBridge } from "./desktop-bridge"
import { FileKindIcon } from "./FilesIcons"
import { FilesPreview } from "./FilesPreview"
import { absolutePath, buildFileTree, fileAction, fileIconKind, fileMenu, formatSize, openForProject, toggleOpen, treeKey, visibleRows, type FileNode, type FileRow, type FileTree, type OpenFolders } from "./files-tree"
import "./files-panel.css"

interface Props {
  onOpenDocument(file: string, view: "schematic"): void
}

/** Each level of the tree steps in by this much. */
const INDENT_PX = 12

/** The listing, read on open, on every "files" event and when the event stream comes back (it may have missed some). */
function useFileTree(): { tree: FileTree | undefined; error: string | undefined } {
  const [tree, setTree] = useState<FileTree>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const listing = await api<FileListing>("/api/files")
        if (!live) return
        setTree(buildFileTree(listing))
        setError(undefined)
      } catch (failure) {
        if (live) setError((failure as Error).message)
      }
    }
    void load()
    const unsubscribe = subscribe(
      (event) => event === "files" && void load(),
      (connected) => connected && void load(),
    )
    return () => {
      live = false
      unsubscribe()
    }
  }, [])
  return { tree, error }
}

/** Copy path and Show in folder; each reports how it went in the panel's status line. */
function useRowCommands(root: string, notify: (note: string) => void) {
  return useCallback(
    (node: FileNode, action: "copy" | "show") => {
      const path = absolutePath(root, node.path)
      const show = desktopBridge()?.showInFolder
      // Show in folder is offered as off without the bridge, so the rejection here is only a guard.
      const run = action === "copy" ? navigator.clipboard.writeText(path) : show ? show(path) : Promise.reject(new Error("not in the desktop app"))
      run.then(
        () => notify(action === "copy" ? `Copied ${path}` : ""),
        (failure: Error) => notify(`${action === "copy" ? "Could not copy the path" : "Could not show it in the folder"}: ${failure.message}`),
      )
    },
    [root, notify],
  )
}

/** The open folders as last left, so switching to another sub-tab and back keeps them; held in memory only. */
const lastOpen: { folders: OpenFolders } = { folders: { root: "", open: new Set() } }

/** The open folders of this project, with the toggle; another project starts with every folder closed. */
function useOpenFolders(root: string) {
  const [folders, setFolders] = useState<OpenFolders>(() => openForProject(lastOpen.folders, root))
  useEffect(() => {
    lastOpen.folders = folders
  }, [folders])
  const open = openForProject(folders, root).open
  const toggle = useCallback((path: string) => setFolders((current) => ({ root, open: toggleOpen(openForProject(current, root).open, path) })), [root])
  return { open, toggle }
}

interface TreeKeys {
  rows: readonly FileRow[]
  current: string | undefined
  list: RefObject<HTMLUListElement | null>
  setFocused(path: string): void
  toggle(path: string): void
  act(node: FileNode): void
  openMenu(node: FileNode, at: Point): void
}

/** The tree keys of files-tree.ts, plus the menu key (and Shift+F10) for the focused row's menu. */
function useTreeKeys({ rows, current, list, setFocused, toggle, act, openMenu }: TreeKeys) {
  const moved = useRef(false)
  // A key moved the focus to another row: focus it once it is drawn.
  useLayoutEffect(() => {
    if (!moved.current) return
    moved.current = false
    list.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(current ?? "")}"]`)?.focus()
  }, [current, list])
  return (event: KeyboardEvent) => {
    const node = rows.find((row) => row.node.path === current)?.node
    if (node && (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))) {
      event.preventDefault()
      const box = (event.target as HTMLElement).getBoundingClientRect()
      return openMenu(node, { x: box.left + box.width / 2, y: box.bottom })
    }
    const move = treeKey(event.key, rows, current ?? "")
    if (move === null) return
    event.preventDefault()
    // The arrows are the tree's, not the canvas's.
    event.stopPropagation()
    if ("focus" in move) {
      moved.current = true
      setFocused(move.focus)
    } else if ("toggle" in move) toggle(move.toggle)
    else if (node) act(node)
  }
}

function FileRowItem({ row, focusable, onAct, onMenu, onFocusRow }: { row: FileRow; focusable: boolean; onAct(node: FileNode): void; onMenu(node: FileNode, at: Point): void; onFocusRow(path: string): void }) {
  const { node, depth, open } = row
  const dir = node.kind === "dir"
  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    onMenu(node, { x: event.clientX, y: event.clientY })
  }
  return (
    <li
      role="treeitem"
      aria-level={depth}
      aria-expanded={dir ? open : undefined}
      tabIndex={focusable ? 0 : -1}
      data-path={node.path}
      className={`files-row${node.kind === "link" ? " link" : ""}`}
      style={{ paddingLeft: `${depth * INDENT_PX}px` }}
      title={dir ? node.path : `${node.path} (${formatSize(node.size)}${node.kind === "link" ? ", a link: not followed" : ""})`}
      onClick={() => onAct(node)}
      onContextMenu={onContextMenu}
      onFocus={() => onFocusRow(node.path)}
    >
      <span className="files-twisty" aria-hidden="true">
        {dir && <ChevronIcon className={open ? "open" : undefined} />}
      </span>
      <FileKindIcon kind={fileIconKind(node)} />
      <span className="files-name">{node.name}</span>
    </li>
  )
}

/** A row's menu: Open where a click opens something, Copy path, Show in folder (off outside the desktop app). */
function RowMenu({ node, at, onClose, onOpen, onCommand }: { node: FileNode; at: Point; onClose(): void; onOpen(node: FileNode): void; onCommand(node: FileNode, action: "copy" | "show"): void }) {
  // Kept between renders: the menu measures and places itself again whenever its entries change.
  const items = useMemo(() => fileMenu(node, desktopBridge()?.showInFolder !== undefined), [node])
  const entries = useMemo(() => items.map(({ label, pending }) => (pending ? { label, pending } : { label })), [items])
  return (
    <ContextMenu
      entries={entries}
      at={at}
      onClose={onClose}
      onRun={(item) => {
        const chosen = items.find((one) => one.label === item.label)?.action
        if (chosen === "open") onOpen(node)
        else if (chosen !== undefined) onCommand(node, chosen)
      }}
    />
  )
}

export function FilesPanel({ onOpenDocument }: Props) {
  const { tree, error } = useFileTree()
  if (error && !tree) return <p className="note files-panel">The project folder could not be read: {error}</p>
  if (!tree) return <p className="note files-panel">Reading the project folder…</p>
  return <FilesTreeView tree={tree} error={error} onOpenDocument={onOpenDocument} />
}

function FilesTreeView({ tree, error, onOpenDocument }: { tree: FileTree; error: string | undefined } & Props) {
  const { open, toggle } = useOpenFolders(tree.root)
  const rows = useMemo(() => visibleRows(tree.nodes, open), [tree, open])
  const [focused, setFocused] = useState<string>()
  const [preview, setPreview] = useState<{ path: string; kind: PreviewKind }>()
  const [menu, setMenu] = useState<{ node: FileNode; at: Point }>()
  const [notice, setNotice] = useState("")
  const list = useRef<HTMLUListElement>(null)
  const command = useRowCommands(tree.root, setNotice)
  // The focused row, or the first when it went away (the agent deleted it) or none was focused yet.
  const current = rows.some((row) => row.node.path === focused) ? focused : rows[0]?.node.path
  const act = (node: FileNode) => {
    const action = fileAction(node)
    if (action.kind === "toggle") toggle(node.path)
    if (action.kind === "document") onOpenDocument(action.file, action.view)
    if (action.kind === "preview") setPreview({ path: node.path, kind: action.preview })
  }
  const openMenu = (node: FileNode, at: Point) => setMenu({ node, at })
  const onKeyDown = useTreeKeys({ rows, current, list, setFocused, toggle, act, openMenu })
  return (
    <nav className="files-panel" aria-label="Files">
      <div className="files-root" title={tree.root}>
        {tree.name}
      </div>
      <ul ref={list} role="tree" aria-label={`Files of ${tree.name}`} onKeyDown={onKeyDown}>
        {rows.map((row) => (
          <FileRowItem key={row.node.path} row={row} focusable={row.node.path === current} onAct={act} onMenu={openMenu} onFocusRow={setFocused} />
        ))}
      </ul>
      {tree.truncated && <p className="note">The folder holds more than is listed here.</p>}
      {error && <p className="note">The list could not be read again: {error}</p>}
      <p className="note files-notice" role="status">
        {notice}
      </p>
      {menu && <RowMenu node={menu.node} at={menu.at} onClose={() => setMenu(undefined)} onOpen={act} onCommand={command} />}
      {preview && <FilesPreview path={preview.path} kind={preview.kind} onClose={() => setPreview(undefined)} />}
    </nav>
  )
}
