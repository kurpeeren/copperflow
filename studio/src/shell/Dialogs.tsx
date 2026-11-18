import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react"
import type { FabricationProfile } from "../../../src/engine/rules/schema.js"
import { CloseIcon } from "../icons"
import { dialogKey, trapStep } from "./dialog-keys"
import { useKeyHold } from "./key-gate"
import { shortcutList } from "./menus"
import { ImportPartForm, type ImportPartPanel } from "./ImportPartDialog"
import { MakeSheetForm, type MakeSheetPanel } from "./MakeSheetDialog"
import { DialogBoundary, lazyRetrying } from "./lazy-dialog"
import { SystemForm, type SystemPanel } from "./SystemDialog"
import { NewCircuitForm, type NewCircuitPanel } from "./NewCircuitDialog"
import { FootprintManagerForm, type FootprintPanel } from "./FootprintManagerDialog"
import type { NewPartPanel } from "./new-part-result"
import type { VerifyPanel } from "./VerifyPartDialog"
import type { PackagesRequest } from "./packages-request"
import { FILLET_RADIUS_LABEL, FILLET_RADIUS_NOTE, filletRadiusField, readFilletRadius } from "./rules-form"

// The New part dialog carries the footprint generator for its preview; it loads when first opened, and again on Retry
// after a failed load.
const newPartForm = lazyRetrying(() => import("./NewPartDialog").then((module) => module.NewPartForm))
// The Packages dialog carries the catalogue, the footprint generator and the 3D shapes: loaded when first opened.
const packagesForm = lazyRetrying(() => import("./PackagesDialog").then((module) => module.PackagesForm))
// The Verify screen carries the footprint drawing, the figures and the datasheet frame: loaded when first opened.
const verifyForm = lazyRetrying(() => import("./VerifyPartDialog").then((module) => module.VerifyPartForm))

export type DialogName = "keys" | "about" | "rules" | "makeSheet" | "importPart" | "newPart" | "system" | "newCircuit" | "footprints" | "exportChecks"

/** What Design → Design rules shows and writes: the rules the build read, and the save of a new fillet radius. */
export interface RulesPanel {
  fabrication: Pick<FabricationProfile, "filletRadius"> | undefined
  save(radius: number | null): Promise<boolean>
}

// Disabled controls are left out, so Tab never stops on a button that cannot be pressed; a disclosure's summary is in.
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])"

/** While open, the dialog holds every key: Esc closes it, Tab goes round its controls, the rest never reach the canvas. */
function useDialogKeys(box: RefObject<HTMLElement | null>, onClose: () => void, onKey?: (event: KeyboardEvent) => void): void {
  useKeyHold(true, (event) => {
    const kind = dialogKey(event.key)
    // The gate stops the press before the dialog's own elements hear it: a dialog with keys of its own takes them here.
    if (kind === "hold") return onKey?.(event)
    event.preventDefault()
    if (kind === "close") return onClose()
    const controls = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const next = trapStep(controls.indexOf(document.activeElement as HTMLElement), controls.length, event.shiftKey)
    ;(controls[next] ?? box.current)?.focus()
  })
}

function Dialog({ title, onClose, children, wide = false, large = false, className, onKey }: { title: string; onClose(): void; children: ReactNode; wide?: boolean; large?: boolean; className?: string; onKey?(event: KeyboardEvent): void }) {
  const box = useRef<HTMLElement>(null)
  // Focus moves into the dialog on open and goes back to what had it on close.
  useEffect(() => {
    const before = document.activeElement
    // A form can name its default control with data-default; else the first control (the Close button) takes the focus.
    const first = box.current?.querySelector<HTMLElement>("[data-default]") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? box.current)?.focus()
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [])
  useDialogKeys(box, onClose, onKey)
  const size = large ? "dialog large" : wide ? "dialog wide" : "dialog"
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={box} tabIndex={-1} className={className ? `${size} ${className}` : size} role="dialog" aria-modal="true" aria-label={title}>
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

/** What Export → Fabrication files asks when the checks report errors: look at them (the default), or export anyway. */
export interface ExportChecksPanel {
  question: string
  showChecks(): void
  exportAnyway(): void
}

function ExportChecksForm({ panel, onClose }: { panel: ExportChecksPanel; onClose(): void }) {
  const done = (step: () => void) => () => {
    onClose()
    step()
  }
  // Show checks is the default: it has the focus when the dialog opens, so Enter takes it.
  return (
    <div className="rules-form">
      <p>{panel.question}</p>
      <button type="button" data-default onClick={done(panel.showChecks)}>
        Show checks
      </button>
      <button type="button" onClick={done(panel.exportAnyway)}>
        Export anyway
      </button>
    </div>
  )
}

/** Help → Keys, Help → About, Design → Design rules, Edit → Make sub-sheet, Library → Import by LCSC number and Library → New part. */
export function StudioDialog({ name, onClose, rules, makeSheet, importPart, newPart, system, newCircuit, footprints, exportChecks }: { name: DialogName; onClose(): void; rules: RulesPanel; makeSheet: MakeSheetPanel; importPart: ImportPartPanel; newPart: NewPartPanel; system: SystemPanel; newCircuit: NewCircuitPanel; footprints: FootprintPanel; exportChecks: ExportChecksPanel }) {
  if (name === "exportChecks") {
    return (
      <Dialog title="Fabrication files" onClose={onClose}>
        <ExportChecksForm panel={exportChecks} onClose={onClose} />
      </Dialog>
    )
  }
  if (name === "footprints") {
    return (
      <Dialog title="Footprint manager" onClose={onClose} wide>
        <FootprintManagerForm panel={footprints} onClose={onClose} />
      </Dialog>
    )
  }
  if (name === "newCircuit") {
    return (
      <Dialog title="New circuit" onClose={onClose}>
        <NewCircuitForm panel={newCircuit} onClose={onClose} />
      </Dialog>
    )
  }
  if (name === "system") {
    return (
      <Dialog title="System settings" onClose={onClose}>
        <SystemForm panel={system} onClose={onClose} />
      </Dialog>
    )
  }
  if (name === "newPart") {
    return (
      <Dialog title="New part" onClose={onClose} wide>
        <DialogBoundary
          what="New part"
          onRetry={newPartForm.retry}
          render={() => {
            const NewPartForm = newPartForm.component()
            return <NewPartForm panel={newPart} onClose={onClose} />
          }}
        />
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

/** Library → Verify… on a part: the large Verify screen, loaded when first opened. */
export function VerifyDialog({ target, panel, onClose }: { target: { id: string; title: string }; panel: VerifyPanel; onClose(): void }) {
  return (
    <Dialog title={`Verify ${target.title}`} onClose={onClose} large>
      <DialogBoundary
        what="Verify"
        onRetry={verifyForm.retry}
        render={() => {
          const VerifyPartForm = verifyForm.component()
          return <VerifyPartForm panel={panel} id={target.id} />
        }}
      />
    </Dialog>
  )
}

/**
 * Tools → Packages…, the Library's Packages… and the browse buttons: the standard packages to search, see and use. It
 * opens over any other dialog (the footprint manager, New part) and closes alone; its form takes the arrows and Enter.
 */
export function PackagesDialog({ request, onClose }: { request: PackagesRequest; onClose(): void }) {
  const keys = useRef<((event: KeyboardEvent) => void) | undefined>(undefined)
  return (
    <Dialog title="Packages" onClose={onClose} className="packages-dialog" onKey={(event) => keys.current?.(event)}>
      <DialogBoundary
        what="Packages"
        onRetry={packagesForm.retry}
        render={() => {
          const PackagesForm = packagesForm.component()
          return <PackagesForm request={request} onClose={onClose} keys={keys} />
        }}
      />
    </Dialog>
  )
}
