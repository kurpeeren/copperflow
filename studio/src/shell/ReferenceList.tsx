// The Layer panel's reference images: a photo, scan or Gerber layer of an existing board under the PCB, to redraw it.
// Each row shows or hides it, fades it, mirrors it (a photo of the bottom side), aligns it by picking points on the
// canvas, and removes it; "Add reference image…" picks a file. Every change is one history entry (core/references.ts).
import { useEffect, useRef, type ChangeEvent } from "react"
import { EyeIcon, TrashIcon } from "../icons"
import type { Actions } from "../use-actions"
import type { ReferenceRecord } from "../../../src/core/layout-references.js"
import { overrideReference, shownReferences, startAligning, stopAligning, useReferenceState } from "../pcb/reference-store"

/** The files the picker offers: photos and scans, and Gerber layers by their usual names. */
const ACCEPT = ".png,.jpg,.jpeg,.gbr,.ger,.pho,.art,.gtl,.gbl,.gto,.gbo,.gts,.gbs,.gtp,.gbp"
/** The largest file sent, as the server takes it. */
const MAX_BYTES = 8 * 1024 * 1024
/** How long an opacity slider rests before its value is written. */
const OPACITY_WRITE_MS = 400

interface Props {
  references: readonly ReferenceRecord[] | undefined
  actions: Pick<Actions, "reference" | "notify">
}

const nameOf = (record: ReferenceRecord) => record.source ?? record.file.replace(/^references\//, "")

/** The file's bytes as base64, for the request. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""))
    reader.onerror = () => reject(reader.error ?? new Error(`${file.name} could not be read`))
    reader.readAsDataURL(file)
  })
}

/** Writes an opacity once the slider has rested; the value shows at once. */
function useOpacityWrite(actions: Props["actions"]) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])
  return (id: string, opacity: number) => {
    overrideReference(id, { opacity })
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => void actions.reference({ action: "set", id, opacity }), OPACITY_WRITE_MS))
  }
}

function ReferenceRow({ record, aligning, actions, onOpacity }: { record: ReferenceRecord; aligning: boolean; actions: Props["actions"]; onOpacity(id: string, value: number): void }) {
  const name = nameOf(record)
  const set = (values: { shown?: boolean; mirror?: boolean }) => {
    overrideReference(record.id, values)
    void actions.reference({ action: "set", id: record.id, ...values })
  }
  const points = record.points.length
  const placed = points === 0 ? "not aligned yet" : `${points} point${points === 1 ? "" : "s"}`
  return (
    <li className={`reference-row${record.shown ? "" : " off"}`}>
      <div className="layer-row">
        <span className="layer-name" title={`${record.id}: ${record.file} (${record.width} × ${record.height} px), ${placed}`}>
          {name}
        </span>
        <button className="layer-eye" aria-pressed={record.shown} aria-label={`Reference ${name}`} title={`${record.shown ? "Hide" : "Show"} ${name}`} onClick={() => set({ shown: !record.shown })}>
          <EyeIcon off={!record.shown} />
        </button>
        <button className="layer-eye" aria-label={`Remove ${name}`} title={`Remove ${name} (the image stays in references/)`} onClick={() => void actions.reference({ action: "remove", id: record.id })}>
          <TrashIcon />
        </button>
      </div>
      <div className="reference-tools">
        <label className="reference-opacity" title="Opacity">
          <input type="range" aria-label={`Opacity of ${name}`} min={0} max={100} value={Math.round(record.opacity * 100)} onChange={(event) => onOpacity(record.id, Number(event.target.value) / 100)} />
        </label>
        <button className={`reference-button${record.mirror ? " on" : ""}`} aria-pressed={record.mirror} title="Mirror left to right: a photo of the bottom side is a mirror image" onClick={() => set({ mirror: !record.mirror })}>
          Mirror
        </button>
        <button className={`reference-button${aligning ? " on" : ""}`} aria-pressed={aligning} title="Click a point on the picture, then where it belongs on the board; two or more pairs align it" onClick={() => (aligning ? stopAligning() : startAligning(record.id))}>
          {aligning ? "Done" : "Align"}
        </button>
      </div>
    </li>
  )
}

/** The reference images under a heading, each with its tools, and the button that adds one. */
export function ReferenceList({ references, actions }: Props) {
  const { aligning, overrides } = useReferenceState()
  const input = useRef<HTMLInputElement>(null)
  const onOpacity = useOpacityWrite(actions)
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > MAX_BYTES) return actions.notify(`${file.name} is larger than ${MAX_BYTES / 1024 / 1024} MB; make it smaller`)
    const data = await base64Of(file).catch((error: Error) => {
      actions.notify(error.message)
      return undefined
    })
    if (data === undefined) return
    const added = await actions.reference({ action: "add", name: file.name, data })
    if (added.ok && added.id) startAligning(added.id)
  }
  const shown = shownReferences(references, overrides)
  return (
    <section className="layer-references hairline-t" aria-label="Reference images">
      <div className="layer-pours-title">Reference images · under the board, never made</div>
      <ul className="layer-list">
        {shown.map((record) => (
          <ReferenceRow key={record.id} record={record} aligning={aligning?.id === record.id} actions={actions} onOpacity={onOpacity} />
        ))}
      </ul>
      <button className="reference-add" onClick={() => input.current?.click()} title="A photo or scan of either side of a board, or a Gerber copper or silkscreen layer">
        Add reference image…
      </button>
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(event) => void pick(event)} />
    </section>
  )
}
