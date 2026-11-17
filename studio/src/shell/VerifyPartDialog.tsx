// Library → Verify…: the screen where a person checks a library part against its datasheet. The footprint to measure,
// the pins and the rest of verification.md to tick (each tick written to the file at once), the datasheet at its page,
// and Mark verified, which stays the person's deliberate act. Loaded when first opened.
import { useCallback, useEffect, useId, useState, type FormEvent } from "react"
import type { Footprint } from "../../../src/engine/footprints/types.js"
import type { PartDetails } from "../api"
import { canMark, screenItems, type ScreenItems } from "./verify-checklist"
import { checkedAgainst } from "./verify-datasheet"
import { VerifyDatasheet } from "./VerifyDatasheet"
import { VerifyFootprint } from "./VerifyFootprint"
import "./verify.css"

/** What the screen reads and writes; the Studio's routes behind it, and nothing an agent can call. */
export interface VerifyPanel {
  load(id: string): Promise<PartDetails>
  /** Ticks items of verification.md by their text; `changed` is the file as it is when it was not the text shown. */
  tick(id: string, items: readonly string[], ticked: boolean, shown: string): Promise<{ checklist: string } | { changed: string }>
  /** POST /api/verify; throws with the server's sentence when refused. */
  mark(id: string, form: { by: string; against: string; confirm: string }): Promise<void>
  frame(id: string, file: string): Promise<string>
  release(address: string): void
  /** Opens the 1:1 print page; false when the browser would not open the window. */
  print(title: string, footprint: Footprint): boolean
}

export const CHANGED_ON_DISK = "verification.md changed since the screen showed it; it shows the file as it is now."
export const PRINT_BLOCKED = "The print window did not open; allow pop-ups for the Studio and try again."
export const STALE_TICKS = "The part changed since these items were ticked: those ticks no longer count, and the next tick clears them from verification.md. Check each item again."

interface ScreenProps {
  details: PartDetails
  checklist: string
  panel: VerifyPanel
  busy: boolean
  problem?: string
  onTick(items: readonly string[], ticked: boolean): void
  onMark(form: { by: string; against: string; confirm: string }): void
  onProblem(message: string): void
}

function Tick({ label, ticked, off, onTick }: { label: string; ticked: boolean; off: boolean; onTick(ticked: boolean): void }) {
  return <input type="checkbox" aria-label={label} checked={ticked} disabled={off} onChange={(event) => onTick(event.target.checked)} />
}

function PinTable({ items, off, onTick }: { items: ScreenItems; off: boolean; onTick: ScreenProps["onTick"] }) {
  return (
    <table className="verify-pins" aria-label="Pins">
      <thead>
        <tr>
          <th scope="col">Pad</th>
          <th scope="col">Name</th>
          <th scope="col">Type</th>
          <th scope="col">Checked</th>
        </tr>
      </thead>
      <tbody>
        {items.pins.map((row) => (
          <tr key={row.number} className={row.kind === "" ? undefined : `verify-${row.kind.toLowerCase()}`}>
            <td>
              {row.number}
              {row.pads > 1 && <span className="verify-pads"> ({row.pads} pads)</span>}
            </td>
            <td>{row.name}</td>
            <td>
              {row.type}
              {row.kind !== "" && <span className="verify-kind">{row.kind}</span>}
            </td>
            <td>
              {row.item ? (
                <Tick label={`Pin ${row.number} ${row.name} matches the datasheet`} ticked={row.item.ticked} off={off} onTick={(ticked) => onTick([row.item?.text ?? ""], ticked)} />
              ) : (
                <span className="verify-missing">not in verification.md</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** "Tick all pins": a deliberate act, with a confirmation that says what it claims. */
function TickAllPins({ items, off, onTick }: { items: ScreenItems; off: boolean; onTick: ScreenProps["onTick"] }) {
  const [asking, setAsking] = useState(false)
  const pins = items.pins.flatMap((row) => (row.item ? [row.item.text] : []))
  if (pins.length === 0) return null
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} disabled={off}>
        Tick all pins…
      </button>
    )
  }
  return (
    <div className="verify-confirm" role="group" aria-label="Tick all pins">
      <button
        type="button"
        onClick={() => {
          setAsking(false)
          onTick(pins, true)
        }}
      >
        I compared all {pins.length} pins with the datasheet
      </button>
      <button type="button" onClick={() => setAsking(false)}>
        Cancel
      </button>
    </div>
  )
}

function MarkForm({ details, items, busy, onMark }: { details: PartDetails; items: ScreenItems; busy: boolean; onMark: ScreenProps["onMark"] }) {
  const { id, part } = details
  const [form, setForm] = useState({ by: "", against: checkedAgainst(part.datasheet, part.datasheet_pages), confirm: "" })
  const field = useId()
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const ready = canMark(id, items, form, details.placeholder !== undefined)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ready) onMark({ by: form.by.trim(), against: form.against.trim(), confirm: form.confirm })
  }
  return (
    <form className="verify-mark" onSubmit={submit}>
      <label htmlFor={`${field}-against`}>Checked against</label>
      <input id={`${field}-against`} value={form.against} onChange={(event) => set("against", event.target.value)} placeholder="Datasheet, revision, page" />
      <label htmlFor={`${field}-by`}>Your name</label>
      <input id={`${field}-by`} value={form.by} onChange={(event) => set("by", event.target.value)} />
      <label htmlFor={`${field}-confirm`}>Type {id} to confirm</label>
      <input id={`${field}-confirm`} value={form.confirm} onChange={(event) => set("confirm", event.target.value)} spellCheck={false} />
      <button type="submit" className="primary" disabled={!ready || busy}>
        Mark verified
      </button>
    </form>
  )
}

function ChecklistColumn({ details, items, busy, onTick, onMark }: { details: PartDetails; items: ScreenItems; busy: boolean; onTick: ScreenProps["onTick"]; onMark: ScreenProps["onMark"] }) {
  const off = details.verified || busy
  return (
    <section className="verify-column" aria-label="Pins and checklist">
      <h3>Pins</h3>
      <PinTable items={items} off={off} onTick={onTick} />
      {!details.verified && <TickAllPins items={items} off={off} onTick={onTick} />}
      <h3>Also check</h3>
      {items.others.length === 0 ? (
        <p className="note">Nothing else in verification.md.</p>
      ) : (
        <ul className="verify-items">
          {items.others.map((item) => (
            <li key={item.text}>
              <label>
                <Tick label={item.text} ticked={item.ticked} off={off} onTick={(ticked) => onTick([item.text], ticked)} /> {item.text}
              </label>
            </li>
          ))}
        </ul>
      )}
      {!details.verified && (
        <>
          <p className="verify-count" role="status">
            {items.total - items.open} of {items.total} items ticked{items.open === 0 ? "; all checked" : ""}. Each tick is written to parts/{details.id}/verification.md, so you can stop and come back.
          </p>
          {details.placeholder && <p className="note warn">{details.placeholder}</p>}
          <MarkForm details={details} items={items} busy={busy} onMark={onMark} />
        </>
      )}
    </section>
  )
}

/** The screen once the part is loaded; plain rendering, so the tests can draw it. */
export function VerifyScreen({ details, checklist, panel, busy, problem, onTick, onMark, onProblem }: ScreenProps) {
  const { part } = details
  const items = screenItems(checklist, details.hash, part.pins, details.footprint)
  const verified = details.verified ? part.verified : undefined
  const print = () => {
    if (details.footprint && !panel.print(`${details.id} ${part.footprint}`, details.footprint)) onProblem(PRINT_BLOCKED)
  }
  return (
    <div className="verify-screen">
      <div className="verify-notes">
        {verified && (
          <p className="note ok">
            Verified by {verified.by} against {verified.against} on {verified.date.slice(0, 10)}. The screen is read-only: a change to part.yaml or footprint.yaml makes the part unverified again.
          </p>
        )}
        {!details.verified && items.stale && <p className="note warn">{STALE_TICKS}</p>}
        {problem && (
          <p className="note error" role="alert">
            {problem}
          </p>
        )}
      </div>
      {details.footprint ? (
        <VerifyFootprint footprint={details.footprint} pins={part.pins} {...(details.placeholder ? { placeholder: details.placeholder } : {})} onPrint={print} />
      ) : (
        <section className="verify-column" aria-label="Footprint">
          <h3>Footprint {part.footprint}</h3>
          <p className="note error">{details.footprintError ?? "The footprint cannot be drawn."}</p>
        </section>
      )}
      <ChecklistColumn details={details} items={items} busy={busy} onTick={onTick} onMark={onMark} />
      <VerifyDatasheet id={details.id} datasheet={part.datasheet} pages={part.datasheet_pages} frame={panel.frame} release={panel.release} />
    </div>
  )
}

/** The dialog's content: loads the part, then keeps verification.md's text as the server last gave it. */
export function VerifyPartForm({ panel, id }: { panel: VerifyPanel; id: string }) {
  const [details, setDetails] = useState<PartDetails>()
  const [checklist, setChecklist] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const load = useCallback(async () => {
    const loaded = await panel.load(id)
    setDetails(loaded)
    setChecklist(loaded.checklist)
  }, [panel, id])
  useEffect(() => {
    load().catch((error: Error) => setProblem(error.message))
  }, [load])
  const work = async (task: () => Promise<void>) => {
    setBusy(true)
    setProblem(undefined)
    try {
      await task()
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const onTick = (items: readonly string[], ticked: boolean) =>
    void work(async () => {
      const answer = await panel.tick(id, items, ticked, checklist)
      if ("changed" in answer) {
        setChecklist(answer.changed)
        setProblem(CHANGED_ON_DISK)
      } else setChecklist(answer.checklist)
    })
  const onMark = (form: { by: string; against: string; confirm: string }) =>
    void work(async () => {
      await panel.mark(id, form)
      await load()
    })
  if (!details) return problem ? <p className="note error" role="alert">{problem}</p> : <p>Loading…</p>
  return <VerifyScreen details={details} checklist={checklist} panel={panel} busy={busy} {...(problem ? { problem } : {})} onTick={onTick} onMark={onMark} onProblem={setProblem} />
}
