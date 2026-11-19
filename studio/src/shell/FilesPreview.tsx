// The Files tab's read-only preview: an image through <img> from a blob URL (an SVG never runs inline), or text in a
// monospace scroll box. The dialog has the app's dialog look and keys: Esc closes, Tab goes round its controls, every
// other key stays in it (dialog-keys.ts, key-gate.ts), and the focus goes back to the row on close.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { api, apiBlob } from "../api"
import type { TextContent } from "../../../src/studio/file-routes.js"
import type { PreviewKind } from "../../../src/studio/file-kinds.js"
import { CloseIcon } from "../icons"
import { dialogKey, trapStep } from "./dialog-keys"
import { formatSize, wrapsLines } from "./files-tree"
import { useKeyHold } from "./key-gate"
import "./files-panel.css"

const FOCUSABLE = "button:not([disabled]), [tabindex]:not([tabindex='-1'])"

type Loaded = { kind: "image"; url: string } | { kind: "text"; content: TextContent } | { kind: "failed"; message: string } | undefined

const fileUrl = (path: string) => `/api/file?path=${encodeURIComponent(path)}`

/** Reads the file once; an image's blob URL is revoked when the preview closes or shows another file. */
function useFileContent(path: string, kind: PreviewKind): Loaded {
  const [loaded, setLoaded] = useState<Loaded>()
  useEffect(() => {
    let url: string | undefined
    let live = true
    const failed = (error: Error) => live && setLoaded({ kind: "failed", message: error.message })
    if (kind === "image") {
      apiBlob(fileUrl(path))
        .then((blob) => {
          if (!live) return
          url = URL.createObjectURL(blob)
          setLoaded({ kind: "image", url })
        })
        .catch(failed)
    } else {
      api<TextContent>(fileUrl(path))
        .then((content) => live && setLoaded({ kind: "text", content }))
        .catch(failed)
    }
    return () => {
      live = false
      if (url !== undefined) URL.revokeObjectURL(url)
    }
  }, [path, kind])
  return loaded
}

function PreviewBody({ path, loaded }: { path: string; loaded: Loaded }): ReactNode {
  if (loaded === undefined) return <p className="note">Reading {path}…</p>
  if (loaded.kind === "failed") return <p className="note">{path} could not be read: {loaded.message}</p>
  if (loaded.kind === "image") return <img className="files-preview-image" src={loaded.url} alt={path} />
  const { text, truncated, size } = loaded.content
  return (
    <>
      {truncated && <p className="note">The file is {formatSize(size)}; the first part is shown.</p>}
      {/* In the tab order so the arrow keys scroll it. */}
      <pre className={wrapsLines(path) ? "files-preview-text wrap" : "files-preview-text"} tabIndex={0}>
        {text}
      </pre>
    </>
  )
}

export function FilesPreview({ path, kind, onClose }: { path: string; kind: PreviewKind; onClose(): void }) {
  const box = useRef<HTMLElement>(null)
  const loaded = useFileContent(path, kind)
  useEffect(() => {
    const before = document.activeElement
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])
  useKeyHold(true, (event) => {
    const key = dialogKey(event.key)
    if (key === "hold") return
    event.preventDefault()
    if (key === "close") return onClose()
    const controls = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    ;(controls[trapStep(controls.indexOf(document.activeElement as HTMLElement), controls.length, event.shiftKey)] ?? box.current)?.focus()
  })
  return (
    <div className="dialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={box} tabIndex={-1} className="dialog wide files-preview" role="dialog" aria-modal="true" aria-label={path}>
        <header className="hairline-b">
          <h2>{path}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">
          <PreviewBody path={path} loaded={loaded} />
        </div>
      </section>
    </div>
  )
}
