import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import { PACKAGE_GROUPS } from "../../../src/engine/footprints/catalogue.js"
import { orbitKey, START, type Orbit } from "../look/orbit"
import { buttonLabel, enterOutcome, formsHint, keptSelection, movedSelection, movesSelection, packageDetails, packageRows, preselects, SHAPE_NOTE, startOf, type GroupChoice, type PackageDetails, type PackageRow, type PackagesPurpose } from "./packages"
import type { PackagesRequest } from "./packages-request"
import { FootprintView, ShapeView } from "./PackageViews"
import "./packages.css"

const ALL = "all"
type Details = PackageDetails | { error: string }

interface ListProps {
  rows: readonly PackageRow[]
  selected: string | undefined
  listId: string
  onSelect(footprint: string): void
  onChoose(footprint: string): void
}

/** The rows; drawn again only when the rows or the selection change, not on every drag or keystroke elsewhere. */
const PackageList = memo(function PackageList({ rows, selected, listId, onSelect, onChoose }: ListProps) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" })
  }, [selected])
  return (
    <>
      <div className="packages-list" ref={list} id={listId} role="listbox" aria-label="Packages">
        <div className="packages-row packages-head" aria-hidden="true">
          <span>Name</span>
          <span>String</span>
          <span>Pads</span>
          <span>Courtyard</span>
          <span>Mount</span>
        </div>
        {rows.map((row) => (
          <div
            key={row.footprint}
            id={`${listId}-${row.footprint}`}
            role="option"
            aria-selected={row.footprint === selected}
            className="packages-row"
            // The focus stays in the search field, so the chosen option is still read out from there.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(row.footprint)}
            onDoubleClick={() => onChoose(row.footprint)}
          >
            <span>{row.name}</span>
            <code>{row.footprint}</code>
            <span>{row.pads}</span>
            <span>{row.size}</span>
            <span>{row.mount === "Surface-mount" ? "SMD" : "THT"}</span>
          </div>
        ))}
      </div>
      {rows.length === 0 && <p className="packages-empty">No package matches. Type the string below if the family takes your size.</p>}
    </>
  )
})

function Facts({ facts, id }: { facts: PackageDetails; id: string }) {
  return (
    <dl className="packages-facts" id={id}>
      <dt>Pads</dt>
      <dd>{facts.pads}</dd>
      <dt>Courtyard</dt>
      <dd>{facts.size}</dd>
      <dt>Mount</dt>
      <dd>{facts.mount}</dd>
      <dt>Height</dt>
      <dd>
        {facts.height} mm, {facts.heightNote}
      </dd>
      <dt>Numbers from</dt>
      <dd>{facts.origin}</dd>
    </dl>
  )
}

interface PreviewProps {
  text: string
  details: Details
  kind?: string
  orbit: Orbit
  onOrbit(orbit: Orbit): void
  shape: React.RefObject<HTMLCanvasElement | null>
  factsId: string
}

function Preview({ text, details, kind, orbit, onOrbit, shape, factsId }: PreviewProps) {
  if (text === "") return <p className="packages-note">Select a package with the arrows or a click, or type a footprint string.</p>
  if ("error" in details) return <p className="packages-problem" role="alert">{details.error}</p>
  return (
    <div className="packages-preview">
      <h3>
        <code>{details.footprint}</code>
      </h3>
      <div className="packages-pictures">
        <FootprintView text={text} />
        <ShapeView text={text} kind={kind} orbit={orbit} onOrbit={onOrbit} focusRef={shape} describedBy={factsId} />
      </div>
      <p className="packages-note">{SHAPE_NOTE} Drag the shape to turn it.</p>
      <Facts facts={details} id={factsId} />
    </div>
  )
}

/** The search, the group, the list's selection and the typed string, and the string shown from them. */
function usePackagesState(initial: string | undefined, purpose: PackagesPurpose) {
  const start = useMemo(() => startOf(initial), [initial])
  const [query, setQuery] = useState("")
  const [group, setGroup] = useState<GroupChoice>(ALL)
  const [picked, setPicked] = useState(start.selected)
  const [typed, setTyped] = useState(start.typed)
  const rows = useMemo(() => packageRows(query, group), [query, group])
  const selected = keptSelection(rows, picked, preselects(purpose))
  const shown = typed.trim() !== "" ? typed.trim() : (selected ?? "")
  const select = useCallback((footprint: string | undefined) => {
    setPicked(footprint)
    setTyped("")
  }, [])
  return { query, setQuery, group, setGroup, rows, selected, select, typed, setTyped, shown }
}

/** Copies the string, and says so in words a screen reader reads out; what it says belongs to the string copied. */
function useCopy(shown: string) {
  const [said, setSaid] = useState({ about: "", text: "" })
  const copy = (text: string) => {
    if (text === "") return
    const byHand = () => setSaid({ about: text, text: `Could not copy; select ${text} and copy it by hand` })
    // Without a secure origin there is no clipboard at all.
    if (!navigator.clipboard?.writeText) return byHand()
    try {
      navigator.clipboard.writeText(text).then(() => setSaid({ about: text, text: `Copied ${text}` }), byHand)
    } catch {
      byHand()
    }
  }
  return { status: said.about === shown ? said.text : "", copy }
}

/** The 3D view's turn, which starts over whenever another package is shown. */
function useOrbitFor(shown: string): [Orbit, (orbit: Orbit) => void] {
  const [turn, setTurn] = useState({ about: shown, orbit: START })
  const set = useCallback((orbit: Orbit) => setTurn({ about: shown, orbit }), [shown])
  return [turn.about === shown ? turn.orbit : START, set]
}

/** The keys the form takes from the dialog: the list's keys, Enter, and the 3D view's own turns while it has the focus. */
function useFormKeys(keys: MutableRefObject<((event: KeyboardEvent) => void) | undefined>, handler: (event: KeyboardEvent) => void) {
  useEffect(() => {
    keys.current = handler
  })
  useEffect(() => () => void (keys.current = undefined), [keys])
}

/** A function that keeps one identity across renders yet always runs the latest one: for the memoised list. */
function useStable<A extends unknown[]>(run: (...args: A) => void): (...args: A) => void {
  const latest = useRef(run)
  useLayoutEffect(() => {
    latest.current = run
  })
  return useCallback((...args: A) => latest.current(...args), [])
}

const isTextField = (element: Element | null) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
/** Controls whose own Enter does their own thing: press, open, toggle. */
const ownsEnter = (element: Element | null) => element instanceof HTMLButtonElement || element instanceof HTMLSelectElement || element?.tagName === "SUMMARY"

export function PackagesForm({ request, onClose, keys }: { request: PackagesRequest; onClose(): void; keys: MutableRefObject<((event: KeyboardEvent) => void) | undefined> }) {
  const state = usePackagesState(request.initial, request.purpose)
  const details = useMemo(() => packageDetails(state.shown), [state.shown])
  const valid = state.shown !== "" && !("error" in details)
  const { status, copy } = useCopy(state.shown)
  const [orbit, setOrbit] = useOrbitFor(state.shown)
  const typedField = useRef<HTMLInputElement>(null)
  const shape = useRef<HTMLCanvasElement>(null)
  const id = useId()
  const useText = buttonLabel(request.purpose)
  const use = (footprint: string) => {
    request.choose?.(footprint)
    onClose()
  }
  const enter = (footprint: string, isValid: boolean) => {
    const outcome = enterOutcome(request.purpose, isValid)
    if (outcome === "use") use(footprint)
    else if (outcome === "copy") copy(footprint)
  }
  const onChoose = useStable((footprint: string) => enter(footprint, true))
  useFormKeys(keys, (event) => {
    const focus = document.activeElement
    if (focus === shape.current) {
      const next = orbitKey(orbit, event.key)
      if (next) {
        event.preventDefault()
        setOrbit(next)
      }
      return
    }
    if (ownsEnter(focus)) return
    if (event.key === "Enter") {
      event.preventDefault()
      return enter(state.shown, valid)
    }
    if (focus !== typedField.current && movesSelection(event.key, isTextField(focus))) {
      event.preventDefault()
      state.select(movedSelection(state.rows, state.selected, event.key))
    }
  })
  return (
    <div className="packages">
      <div className="packages-browse">
        <div className="packages-search">
          <input
            data-default
            type="search"
            placeholder="Search packages: sot23, QFN 5x5, crystal"
            aria-label="Search packages"
            aria-controls={`${id}-list`}
            aria-activedescendant={state.selected && state.typed === "" ? `${id}-list-${state.selected}` : undefined}
            value={state.query}
            onChange={(event) => state.setQuery(event.target.value)}
          />
          <select aria-label="Group" value={state.group} onChange={(event) => state.setGroup(event.target.value as GroupChoice)}>
            <option value={ALL}>All groups</option>
            {PACKAGE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </div>
        <p className="packages-count" aria-live="polite">
          {state.rows.length} package{state.rows.length === 1 ? "" : "s"}
        </p>
        <PackageList rows={state.rows} selected={state.typed === "" ? state.selected : undefined} listId={`${id}-list`} onSelect={state.select} onChoose={onChoose} />
        <label htmlFor={`${id}-typed`}>Or type any footprint string</label>
        <input id={`${id}-typed`} ref={typedField} value={state.typed} placeholder="tssop24, qfn40_6x6_p0.5" spellCheck={false} aria-describedby={`${id}-forms`} onChange={(event) => state.setTyped(event.target.value)} />
        <details className="packages-forms">
          <summary>Families that take any size</summary>
          <pre id={`${id}-forms`}>{formsHint()}</pre>
        </details>
      </div>
      <div className="packages-side">
        <Preview text={state.shown} details={details} kind={request.kind} orbit={orbit} onOrbit={setOrbit} shape={shape} factsId={`${id}-facts`} />
        <div className="packages-actions">
          <span className="packages-status" role="status">
            {status}
          </span>
          <button type="button" disabled={state.shown === ""} onClick={() => copy(state.shown)}>
            Copy string
          </button>
          {useText && (
            <button type="button" className="primary" disabled={!valid} onClick={() => use(state.shown)}>
              {useText}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
