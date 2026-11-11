import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react"
import type { PinTableError } from "../../../src/library/pin-table.js"
import { PALETTE } from "../pcb/ctx"
import { footprintPreview, type FootprintPreview } from "./footprint-preview"
import {
  createdSummary,
  EMPTY_FIELDS,
  PIN_TYPES,
  readCreateRequest,
  withoutPin,
  withPasted,
  withPin,
  withPinChanged,
  type CreatePartResult,
  type NewPartFields,
  type PinField,
} from "./new-part-form"
import type { NewPartPanel } from "./new-part-result"

const PREVIEW_SIZE = { width: 240, height: 150 }

/**
 * The preview draws in the PCB view's colours (PALETTE), so a footprint looks the same here as on the board: top copper
 * or plated pads, drills, top silkscreen and the assembly outlines. The PCB view keeps them in both themes, as does this.
 */
const PREVIEW_LOOK = {
  board: PALETTE.background,
  pad: PALETTE.topCopper,
  throughPad: PALETTE.multiLayer,
  drill: PALETTE.drill,
  outline: PALETTE.topAssembly,
  silk: PALETTE.topSilk,
}

function drawPreview(canvas: HTMLCanvasElement, preview: FootprintPreview): void {
  const ratio = window.devicePixelRatio || 1
  canvas.width = PREVIEW_SIZE.width * ratio
  canvas.height = PREVIEW_SIZE.height * ratio
  const context = canvas.getContext("2d")
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.fillStyle = PREVIEW_LOOK.board
  context.fillRect(0, 0, PREVIEW_SIZE.width, PREVIEW_SIZE.height)
  const stroke = (lines: readonly (readonly { x: number; y: number }[])[], colour: string, closed: boolean, dash: number[] = []) => {
    context.strokeStyle = colour
    context.lineWidth = 1
    context.setLineDash(dash)
    for (const line of lines) {
      context.beginPath()
      line.forEach((p, i) => (i === 0 ? context.moveTo(p.x, p.y) : context.lineTo(p.x, p.y)))
      if (closed) context.closePath()
      context.stroke()
    }
    context.setLineDash([])
  }
  stroke([preview.courtyard], PREVIEW_LOOK.outline, true, [3, 3])
  stroke(preview.body, PREVIEW_LOOK.outline, false)
  stroke(preview.silkscreen, PREVIEW_LOOK.silk, false)
  for (const pad of preview.pads) {
    context.save()
    context.translate(pad.x, pad.y)
    context.rotate((pad.rotation * Math.PI) / 180)
    context.fillStyle = pad.through ? PREVIEW_LOOK.throughPad : PREVIEW_LOOK.pad
    context.beginPath()
    if (pad.shape === "circle" || pad.shape === "oval") context.ellipse(0, 0, pad.width / 2, pad.height / 2, 0, 0, 2 * Math.PI)
    else context.rect(-pad.width / 2, -pad.height / 2, pad.width, pad.height)
    context.fill()
    if (pad.drill) {
      context.fillStyle = PREVIEW_LOOK.drill
      context.beginPath()
      context.arc(0, 0, pad.drill / 2, 0, 2 * Math.PI)
      context.fill()
    }
    context.restore()
  }
  const first = preview.pads.find((pad) => pad.number === "1")
  if (first) {
    context.fillStyle = PREVIEW_LOOK.silk
    context.font = "10px sans-serif"
    context.fillText("1", first.x - first.width / 2 - 8, first.y + 3)
  }
}

/** The footprint string drawn by copperflow's generator, or why it cannot be. */
function PackagePreview({ text }: { text: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useMemo(() => footprintPreview(text, PREVIEW_SIZE), [text])
  useEffect(() => {
    if (canvas.current && !("error" in preview)) drawPreview(canvas.current, preview)
  }, [preview])
  if ("error" in preview) return <p className="new-part-preview-note">{preview.error}</p>
  return (
    <figure className="new-part-preview">
      <canvas ref={canvas} style={PREVIEW_SIZE} role="img" aria-label={`Footprint ${text.trim()}: ${preview.summary}`} />
      <figcaption>{preview.summary}</figcaption>
    </figure>
  )
}

function PinRows({ pins, onChange }: { pins: PinField[]; onChange(pins: PinField[]): void }) {
  return (
    <table className="new-part-pins">
      <thead>
        <tr>
          <th>Pin</th>
          <th>Name</th>
          <th>Type</th>
          <th>Description</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {pins.map((pin, index) => (
          <tr key={index}>
            <td>
              <input aria-label={`Row ${index + 1} pin number`} value={pin.number} onChange={(e) => onChange(withPinChanged(pins, index, { number: e.target.value }))} />
            </td>
            <td>
              <input aria-label={`Row ${index + 1} pin name`} value={pin.name} onChange={(e) => onChange(withPinChanged(pins, index, { name: e.target.value }))} />
            </td>
            <td>
              <select aria-label={`Row ${index + 1} pin type`} value={pin.type} onChange={(e) => onChange(withPinChanged(pins, index, { type: e.target.value as PinField["type"] }))}>
                {PIN_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <input aria-label={`Row ${index + 1} description`} value={pin.description} onChange={(e) => onChange(withPinChanged(pins, index, { description: e.target.value }))} />
            </td>
            <td>
              <button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => onChange(withoutPin(pins, index))}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The paste area: a datasheet's pin table, read by pin-table.ts; each line it cannot read is listed. */
function PasteArea({ pins, onChange }: { pins: PinField[]; onChange(pins: PinField[]): void }) {
  const [text, setText] = useState("")
  const [errors, setErrors] = useState<PinTableError[]>([])
  const field = useId()
  const add = () => {
    const pasted = withPasted(pins, text)
    onChange(pasted.pins)
    setErrors(pasted.errors)
    if (pasted.errors.length === 0) setText("")
  }
  return (
    <div className="new-part-paste">
      <label htmlFor={field}>Paste a pin table: one pin per line, "1 VDD power_in", tab or comma separated; no type means passive.</label>
      <textarea id={field} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" onClick={add} disabled={text.trim() === ""}>
        Add pasted pins
      </button>
      {errors.length > 0 && (
        <ul role="alert">
          {errors.map((error) => (
            <li key={error.line}>{error.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Suppliers({ fields, onChange }: { fields: NewPartFields["suppliers"]; onChange(suppliers: NewPartFields["suppliers"]): void }) {
  const change = (index: number, key: "supplier" | "number", value: string) => onChange(fields.map((row, at) => (at === index ? { ...row, [key]: value } : row)))
  return (
    <>
      {fields.map((row, index) => (
        <div className="new-part-supplier" key={index}>
          <input aria-label={`Supplier ${index + 1}`} placeholder="lcsc" value={row.supplier} onChange={(e) => change(index, "supplier", e.target.value)} />
          <input aria-label={`Supplier ${index + 1} part number`} placeholder="C16212" value={row.number} onChange={(e) => change(index, "number", e.target.value)} />
        </div>
      ))}
      <button type="button" className="new-part-add" onClick={() => onChange([...fields, { supplier: "", number: "" }])}>
        Add supplier
      </button>
    </>
  )
}

function Result({ result }: { result: CreatePartResult }) {
  return (
    <div className="import-result" role="status">
      <p>
        <strong>{createdSummary(result)}</strong>
      </p>
      {result.notes.length > 0 && (
        <ul>
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <h3>Written</h3>
      <ul>
        {result.files.map((file) => (
          <li key={file}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
      <h3>
        <code>{result.verification}</code>
      </h3>
      <pre className="new-part-checklist">{result.checklist}</pre>
    </div>
  )
}

/** Library → New part…: the part from its datasheet, written unverified; then its checklist. */
export function NewPartForm({ panel, onClose }: { panel: NewPartPanel; onClose(): void }) {
  const [fields, setFields] = useState<NewPartFields>(() => ({ ...EMPTY_FIELDS, pins: withPin([]) }))
  const [problems, setProblems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CreatePartResult>()
  const id = useId()
  const set = <K extends keyof NewPartFields>(key: K, value: NewPartFields[K]) => setFields((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (result) return onClose()
    const request = readCreateRequest(fields)
    if ("problems" in request) return setProblems(request.problems)
    setBusy(true)
    setProblems([])
    try {
      setResult(await panel.create(request))
    } catch (error) {
      setProblems([(error as Error).message])
    } finally {
      setBusy(false)
    }
  }
  if (result) {
    return (
      <form className="rules-form new-part-form" onSubmit={(event) => void submit(event)}>
        <Result result={result} />
        <button type="submit">Close</button>
      </form>
    )
  }
  const text = (key: "id" | "title" | "manufacturer" | "mpn" | "datasheet", label: string, placeholder: string) => (
    <>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input id={`${id}-${key}`} value={fields[key]} placeholder={placeholder} disabled={busy} onChange={(e) => set(key, e.target.value)} />
    </>
  )
  return (
    <form className="rules-form new-part-form" onSubmit={(event) => void submit(event)}>
      {text("id", "Part id", "AP2112K-3.3")}
      {text("title", "Title", "3.3 V LDO regulator")}
      {text("manufacturer", "Manufacturer", "Diodes Incorporated")}
      {text("mpn", "MPN", "AP2112K-3.3TRG1")}
      <span>Package</span>
      <div className="new-part-package">
        <label>
          <input type="radio" name={`${id}-kind`} checked={fields.packageKind === "string"} onChange={() => set("packageKind", "string")} /> Footprint string
        </label>
        <label>
          <input type="radio" name={`${id}-kind`} checked={fields.packageKind === "file"} onChange={() => set("packageKind", "file")} /> Footprint file
        </label>
      </div>
      {fields.packageKind === "string" ? (
        <>
          <label htmlFor={`${id}-package`}>Footprint</label>
          <input id={`${id}-package`} value={fields.packageText} placeholder="soic8, qfn32_5x5_p0.5, hc49s" onChange={(e) => set("packageText", e.target.value)} />
          <PackagePreview text={fields.packageText} />
        </>
      ) : (
        <p>footprint.yaml is written as a placeholder, one pad per pin. The schematic can use the part now; the board reports an error for it until you draw its pads from the datasheet's land pattern and delete "placeholder: true".</p>
      )}
      <h3>Pins</h3>
      <PinRows pins={fields.pins} onChange={(pins) => set("pins", pins)} />
      <button type="button" className="new-part-add" onClick={() => set("pins", withPin(fields.pins))}>
        Add pin
      </button>
      <PasteArea pins={fields.pins} onChange={(pins) => set("pins", pins)} />
      <h3>Suppliers</h3>
      <Suppliers fields={fields.suppliers} onChange={(suppliers) => set("suppliers", suppliers)} />
      {text("datasheet", "Datasheet URL", "https://…")}
      <label className="make-sheet-rename">
        <input type="checkbox" checked={fields.replace} onChange={(e) => set("replace", e.target.checked)} />
        Replace a part with this id that is not verified
      </label>
      {problems.length > 0 && (
        <ul className="new-part-problems" role="alert">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <p>The part is written unverified; check it against the datasheet in its verification.md.</p>
      <button type="submit" disabled={busy}>
        {busy ? "Writing…" : "Create part"}
      </button>
    </form>
  )
}
