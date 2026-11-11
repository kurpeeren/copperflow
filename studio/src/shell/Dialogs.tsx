import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react"
import type { FabricationProfile } from "../../../src/engine/rules/schema.js"
import { CloseIcon } from "../icons"
import { dialogKey, trapStep } from "./dialog-keys"
import { useKeyHold } from "./key-gate"
import { shortcutList } from "./menus"
import { ImportPartForm, type ImportPartPanel } from "./ImportPartDialog"
import { MakeSheetForm, type MakeSheetPanel } from "./MakeSheetDialog"
import type { NewPartPanel } from "./new-part-result"
import { FILLET_RADIUS_LABEL, FILLET_RADIUS_NOTE, filletRadiusField, readFilletRadius } from "./rules-form"

// The New part dialog carries the footprint generator for its preview; it loads when first opened.
const NewPartForm = lazy(() => import("./NewPartDialog").then((module) => ({ default: module.NewPartForm })))

export type DialogName = "keys" | "about" | "rules" | "makeSheet" | "importPart" | "newPart"

/** What Design → Design rules shows and writes: the rules the build read, and the save of a new fillet radius. */
export interface RulesPanel {
  fabrication: Pick<FabricationProfile, "filletRadius"> | undefined
  save(radius: number | null): Promise<boolean>
}

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"

/** While open, the dialog holds every key: Esc closes it, Tab goes round its controls, the rest never reach the canvas. */
function useDialogKeys(box: RefObject<HTMLElement | null>, onClose: () => void): void {
  useKeyHold(true, (event) => {
    const kind = dialogKey(event.key)
    if (kind === "hold") return
    event.preventDefault()
    if (kind === "close") return onClose()
    const controls = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const next = trapStep(controls.indexOf(document.activeElement as HTMLElement), controls.length, event.shiftKey)
    ;(controls[next] ?? box.current)?.focus()
  })
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLElement>(null)
  // Focus moves into the dialog on open and goes back to what had it on close.
  useEffect(() => {
    const before = document.activeElement
    const first = box.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? box.current)?.focus()
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])
  useDialogKeys(box, onClose)
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} tabIndex={-1} className={wide ? "dialog wide" : "dialog"} role="dialog" aria-modal="true" aria-label={title}>
        <header className="hairline-b">
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>
  )
}

function KeysList() {
  return (
    <table>
      <tbody>
        {shortcutList().map((row) => (
          <tr key={row.keys}>
            <td>
              <kbd>{row.keys}</kbd>
            </td>
            <td>{row.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The Design rules panel's form: the Fillet radius, written to rules.yaml on Save. */
function RulesForm({ rules, onClose }: { rules: RulesPanel; onClose(): void }) {
  const field = filletRadiusField(rules.fabrication)
  const [text, setText] = useState(field.value)
  const [problem, setProblem] = useState<string>()
  const id = useId()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const read = readFilletRadius(text)
    if ("message" in read) return setProblem(read.message)
    if (text.trim() === field.value) return onClose()
    if (await rules.save(read.radius)) onClose()
  }
  return (
    <form className="rules-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor={id}>{FILLET_RADIUS_LABEL}</label>
      <input id={id} value={text} placeholder={field.placeholder} onChange={(event) => setText(event.target.value)} aria-describedby={`${id}-note`} aria-invalid={problem !== undefined} />
      <p id={`${id}-note`}>{problem ?? FILLET_RADIUS_NOTE}</p>
      <p>The rest of the design rules are in rules.yaml in the project.</p>
      <button type="submit">Save</button>
    </form>
  )
}

/** Help → Keys, Help → About, Design → Design rules, Edit → Make sub-sheet, Library → Import by LCSC number and Library → New part. */
export function StudioDialog({ name, onClose, rules, makeSheet, importPart, newPart }: { name: DialogName; onClose(): void; rules: RulesPanel; makeSheet: MakeSheetPanel; importPart: ImportPartPanel; newPart: NewPartPanel }) {
  if (name === "newPart") {
    return (
      <Dialog title="New part" onClose={onClose} wide>
        <Suspense fallback={<p>Loading…</p>}>
          <NewPartForm panel={newPart} onClose={onClose} />
        </Suspense>
      </Dialog>
    )
  }
  if (name === "importPart") {
    return (
      <Dialog title="Import by LCSC number" onClose={onClose}>
        <ImportPartForm panel={importPart} onClose={onClose} />
      </Dialog>
    )
  }
  if (name === "makeSheet") {
    return (
      <Dialog title="Make sub-sheet" onClose={onClose}>
        <MakeSheetForm panel={makeSheet} onClose={onClose} />
      </Dialog>
    )
  }
  if (name === "rules") {
    return (
      <Dialog title="Design rules" onClose={onClose}>
        <RulesForm rules={rules} onClose={onClose} />
      </Dialog>
    )
  }
  if (name === "keys") {
    return (
      <Dialog title="Keys" onClose={onClose}>
        <KeysList />
      </Dialog>
    )
  }
  return (
    <Dialog title="About copperflow" onClose={onClose}>
      <p>
        <strong>copperflow</strong> Studio
      </p>
      <p>Design circuits in code with a human and an AI agent editing the same files.</p>
      <p>Apache License 2.0</p>
    </Dialog>
  )
}
