// File → Import a drawing (SVG or DXF)…: choose the file, see what it is (its size, what the reader left out, a small
// picture of its shapes), choose the layer, the width, whether to fill closed outlines and a name, then Import places
// it at the board's centre. A refusal from the server stays in the dialog. The state is in graphic-import-form.ts;
// this module carries the engine's drawing reader, so the dialog loads when first opened.
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react"
import { afterImport, cachedPreview, fieldProblems, fileProblem, latestOnly, netNames, graphicImportRequest, graphicLayerChoices, graphicNetChoices, NET_NOTE, showsNet, keptHeight, readPickedDrawing, showsFill, sizeLine, skippedLine, startForm, type GraphicForm, type GraphicImportRequest, type GraphicLayerChoice, type PickedDrawing } from "./graphic-import-form"
import "./graphic-import.css"

/** What the dialog asks of the Studio: the board's copper layers, and the import itself with the server's refusal. */
export interface GraphicImportPanel {
  boardLayers: number
  /** The circuit's nets, for a drawing on copper. */
  nets: readonly { names: readonly string[] }[]
  send(request: GraphicImportRequest): Promise<{ ok: boolean; refusal?: string }>
}

/** The picture's longer side, in CSS pixels. */
const PREVIEW_PX = 160

function Preview({ picked }: { picked: PickedDrawing }) {
  // Built once per drawing: typing in Width or Name does not rebuild the paths.
  const shape = useMemo(() => cachedPreview(picked.shapes, PREVIEW_PX), [picked.shapes])
  return (
    <svg className="graphic-preview" width={shape.width} height={shape.height} viewBox={`0 0 ${shape.width} ${shape.height}`} role="img" aria-label={`Preview of ${picked.name}`}>
      {shape.fills.map((d, i) => (
        <path key={`f${i}`} d={d} fillRule="evenodd" />
      ))}
      {shape.strokes.map((stroke, i) => (
        <path key={`s${i}`} d={stroke.d} className="graphic-preview-line" strokeWidth={stroke.width} />
      ))}
    </svg>
  )
}

function NetField({ form, nets, onChange }: { form: GraphicForm; nets: GraphicImportPanel["nets"]; onChange(form: GraphicForm): void }) {
  const id = useId()
  return (
    <>
      <label htmlFor={`${id}-net`}>Net</label>
      <select id={`${id}-net`} value={form.net} aria-describedby={`${id}-note`} onChange={(event) => onChange({ ...form, net: event.target.value })}>
        {graphicNetChoices(nets).map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <p id={`${id}-note`}>{NET_NOTE}</p>
    </>
  )
}

/** A field's problem under it, tied to it by `id`; nothing while it has none. */
const Problem = ({ id, text }: { id: string; text: string | undefined }) =>
  text === undefined ? null : (
    <p id={id} role="alert">
      {text}
    </p>
  )

function Fields({ picked, form, boardLayers, nets, onChange }: { picked: PickedDrawing; form: GraphicForm; boardLayers: number; nets: GraphicImportPanel["nets"]; onChange(form: GraphicForm): void }) {
  const id = useId()
  const height = keptHeight(picked.shapes, form.width)
  const problems = fieldProblems(picked, form)
  return (
    <>
      <label htmlFor={`${id}-layer`}>Layer</label>
      <select id={`${id}-layer`} value={form.layer} onChange={(event) => onChange({ ...form, layer: event.target.value as GraphicLayerChoice })}>
        {graphicLayerChoices(boardLayers).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
      {showsNet(form.layer) && <NetField form={form} nets={nets} onChange={onChange} />}
      <label htmlFor={`${id}-width`}>Width (mm)</label>
      <span className="graphic-import-size">
        <input id={`${id}-width`} inputMode="decimal" value={form.width} onChange={(event) => onChange({ ...form, width: event.target.value })} aria-invalid={problems.width !== undefined} aria-describedby={problems.width ? `${id}-height ${id}-width-problem` : `${id}-height`} />
        <span id={`${id}-height`}>{height === undefined ? "Height follows the width" : `Height ${height} mm`}</span>
      </span>
      <Problem id={`${id}-width-problem`} text={problems.width} />
      {showsFill(picked.shapes) && (
        <label className="graphic-import-fill">
          <input type="checkbox" checked={form.fill} onChange={(event) => onChange({ ...form, fill: event.target.checked })} />
          Fill closed outlines
        </label>
      )}
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} value={form.name} aria-invalid={problems.name !== undefined} aria-describedby={problems.name ? `${id}-name-problem` : undefined} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      <Problem id={`${id}-name-problem`} text={problems.name} />
    </>
  )
}

/** The chosen file read into the dialog, or the reason it cannot be. */
function useChosenFile() {
  const [picked, setPicked] = useState<PickedDrawing>()
  const [form, setForm] = useState<GraphicForm>()
  const [problem, setProblem] = useState<string>()
  // Only the latest pick counts: a slower read of an earlier file is dropped.
  const reads = useRef(latestOnly()).current
  const read = (file: File) => {
    const early = fileProblem(file.name, file.size)
    if (early) return setProblem(early)
    const mine = reads.next()
    return file
      .text()
      .then((text) => {
        if (!reads.isLatest(mine)) return
        const read = readPickedDrawing(file.name, text, file.size)
        if ("message" in read) return setProblem(read.message)
        setPicked(read)
        setForm(startForm(read))
        setProblem(undefined)
      })
      .catch((error: Error) => reads.isLatest(mine) && setProblem(`${file.name} could not be read: ${error.message}`))
  }
  // The system file picker, from an input made for the one choice, so the form holds no hidden control for Tab to stop on.
  const choose = () => {
    const picker = Object.assign(document.createElement("input"), { type: "file", accept: ".svg,.dxf" })
    picker.addEventListener("change", () => {
      const file = picker.files?.[0]
      if (file) read(file)
    })
    picker.click()
  }
  return { picked, form, setForm, problem, setProblem, choose }
}

/** The dialog's form; `keys` takes Enter from the dialog's key hold, which imports when the form is ready. */
export function GraphicImportForm({ panel, onClose, keys }: { panel: GraphicImportPanel; onClose(): void; keys: RefObject<((event: KeyboardEvent) => void) | undefined> }) {
  const chosen = useChosenFile()
  const { picked, form } = chosen
  const [busy, setBusy] = useState(false)
  const request = picked && form ? graphicImportRequest(picked, form, netNames(panel.nets)) : undefined
  // Whether the dialog is still open when an import finishes: Esc may have closed it meanwhile.
  const open = useRef(true)
  useEffect(() => () => void (open.current = false), [])
  const ready = request !== undefined && !("message" in request) && !busy
  const submit = async () => {
    if (!request || busy || "message" in request) return
    setBusy(true)
    const next = afterImport(await panel.send(request), open.current)
    if (!open.current) return
    setBusy(false)
    if (next.close) return onClose()
    chosen.setProblem(next.problem)
  }
  keys.current = (event) => {
    const onButton = event.target instanceof HTMLButtonElement
    if (event.key !== "Enter" || onButton || !ready) return
    event.preventDefault()
    void submit()
  }
  return (
    <form
      className="rules-form graphic-import"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <span>Drawing</span>
      <button type="button" className="graphic-import-choose" data-default autoFocus aria-label={picked ? `Drawing: ${picked.name}. Choose another file` : "Choose a drawing file"} onClick={chosen.choose}>
        {picked ? "Choose another file…" : "Choose a file…"}
      </button>
      {picked && (
        <div className="graphic-import-about">
          <Preview picked={picked} />
          <p>
            {picked.name}: {sizeLine(picked.shapes)}
          </p>
          {skippedLine(picked.shapes) && <p>{skippedLine(picked.shapes)}</p>}
        </div>
      )}
      {picked && form && <Fields picked={picked} form={form} boardLayers={panel.boardLayers} nets={panel.nets} onChange={chosen.setForm} />}
      <p role={chosen.problem ? "alert" : undefined}>{chosen.problem ?? (picked ? "Placed at the board's centre; drag it where it goes." : "An SVG or DXF file, up to 1 MB.")}</p>
      <button type="submit" disabled={!ready}>
        Import
      </button>
    </form>
  )
}
