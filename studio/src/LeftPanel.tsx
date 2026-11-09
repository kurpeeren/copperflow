import { useState } from "react"
import type { CircuitData, Design, PartsData, TraceInfo } from "./api"
import { Library } from "./Library"
import { NetsList } from "./NetsList"
import type { Highlight } from "./pcb/highlight"
import type { Actions } from "./App"
import { clicked, type Selection, type SelectionChange } from "./selection"
import { blurAfterPointerClick } from "./shell/focus"
import { PageTree } from "./shell/PageTree"
import type { PageTree as PageTreeData, DocView } from "./shell/page-tree"
import { sideTabId, stripPanelId } from "./shell/SideStrip"
import type { DesignSub, LeftState } from "./shell/strip-state"
import { useTabList } from "./shell/use-tab-list"
import { partsInSelector } from "../../src/core/selectors.js"
import { CloseIcon, LockIcon } from "./icons"

interface Props {
  circuit: CircuitData
  parts: PartsData
  onPlace(part: string): void
  selection: Selection
  onSelect(change: SelectionChange): void
  actions: Actions
  /** The built design, for the Net tab. */
  design: Design | undefined
  left: LeftState
  onSub(sub: DesignSub): void
  pageTree: PageTreeData
  onOpenDocument(file: string, view: DocView): void
  /** Shift+F asked for the Library search field. */
  focusSearch: boolean
  onSearchFocused(): void
  /** Ctrl+O asked for the first file of the Page tree. */
  focusPage: boolean
  onPageFocused(): void
  highlight: Highlight
  onHighlight(nets: Highlight): void
  hidden: boolean
}

const SUB_NAMES: Record<DesignSub, string> = { page: "Page", net: "Net", component: "Component", object: "Object" }
const SUBS = Object.keys(SUB_NAMES) as DesignSub[]
const DESIGN_PANEL_ID = "design-panel"

/** Page, Net, Component and Object across the top of Project Design. */
function SubTabs({ sub, onSub }: { sub: DesignSub; onSub(sub: DesignSub): void }) {
  const list = useTabList({ ids: SUBS, current: sub, onSelect: onSub })
  return (
    <div className="sub-tabs hairline-b" role="tablist" aria-label="Project Design" onKeyDown={list.onKeyDown}>
      {SUBS.map((t) => (
        <button key={t} role="tab" id={`sub-tab-${t}`} aria-controls={DESIGN_PANEL_ID} aria-selected={sub === t} className={`sub-tab${sub === t ? " on" : ""}`} {...list.tab(t)}>
          {SUB_NAMES[t]}
        </button>
      ))}
    </div>
  )
}

/** Project Design (Page, Net, Component, Object) or Common Library, depending on the strip. */
export function LeftPanel(props: Props) {
  const { left, onSub } = props
  const design = left.strip === "design"
  return (
    <aside className="panel left hairline-r" id={stripPanelId("left")} role="tabpanel" aria-labelledby={sideTabId(left.strip)} hidden={props.hidden} onClick={blurAfterPointerClick}>
      {design && <SubTabs sub={left.sub} onSub={onSub} />}
      <div className="panel-body" {...(design ? { id: DESIGN_PANEL_ID, role: "tabpanel", "aria-labelledby": `sub-tab-${left.sub}` } : {})}>
        {!design && <Library parts={props.parts} onPlace={props.onPlace} focus={props.focusSearch} onFocused={props.onSearchFocused} />}
        {design && <DesignBody {...props} />}
      </div>
    </aside>
  )
}

function DesignBody(props: Props) {
  switch (props.left.sub) {
    case "page":
      return <PageTree tree={props.pageTree} onOpen={props.onOpenDocument} focus={props.focusPage} onFocused={props.onPageFocused} />
    case "net":
      return <NetsList design={props.design} highlight={props.highlight} onHighlight={props.onHighlight} />
    case "component":
      return <PartsTree {...props} />
    case "object":
      return <Connections {...props} />
  }
}

/**
 * The parts by kind; every selected one is highlighted (and marked selected for assistive tech), a click selects one,
 * and Ctrl+click (or Shift+click) toggles one.
 */
function PartsTree({ circuit, parts: library, selection, onSelect }: Props) {
  const locked = new Set(circuit.annotations.locks.map((lock) => lock.part))
  const title = (tag: string) => library.library.find((p) => p.component === tag)?.title ?? tag
  const groups = new Map<string, typeof circuit.model.parts>()
  for (const part of circuit.model.parts) groups.set(part.tag, [...(groups.get(part.tag) ?? []), part])
  return (
    <div className="tree">
      {[...groups].map(([tag, parts]) => (
        <section key={tag}>
          <h3 title={tag}>
            {title(tag)} <span className="count">{parts.length}</span>
          </h3>
          {/* The rows are placed parts: Delete and Backspace on a focused row remove the selected parts (canvas-keys.ts). */}
          <ul role="listbox" aria-multiselectable="true" aria-label={title(tag)} data-keys="parts">
            {parts.map((part) => (
              <li key={part.name} role="none">
                <button
                  role="option"
                  aria-selected={selection.has(part.name)}
                  className={`row${selection.has(part.name) ? " selected" : ""}${part.editable ? "" : " readonly"}`}
                  onClick={(event) => onSelect(clicked(part.name, event))}
                  title={part.readonlyReason ? `Read-only: ${part.readonlyReason}` : undefined}
                >
                  <span className="name">{part.name}</span>
                  <span className="value">{summaryValue(part.props)}</span>
                  {locked.has(part.name) && <LockIcon className="locked-icon" aria-label="Locked" />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {circuit.model.skipped.length > 0 && (
        <p className="note">
          {circuit.model.skipped.length} element(s) cannot be edited here; see the code.
        </p>
      )}
    </div>
  )
}

/** The value people recognise a part by: resistance, capacitance, colour or footprint. */
function summaryValue(props: CircuitData["model"]["parts"][number]["props"]): string {
  for (const key of ["resistance", "capacitance", "inductance", "color", "footprint", "standard"]) {
    const literal = props[key]?.literal
    if (literal !== undefined) return String(literal)
  }
  return ""
}

/** The connections, each with its remove button; those that touch a selected part are highlighted. */
function Connections({ circuit, selection, actions }: Props) {
  return (
    <div className="connections">
      <ul>
        {circuit.model.traces.map((trace, index) => (
          <li key={`${trace.from}-${trace.to}-${index}`} className={selection.names.some((part) => touches(trace, part)) ? "selected" : ""}>
            <code>{trace.editable ? trace.from : `line ${trace.line}`}</code>
            <span className="arrow" aria-hidden="true">
              —
            </span>
            <code>{trace.editable ? trace.to : "read-only"}</code>
            <button
              className="icon"
              disabled={!trace.editable}
              aria-label={`Remove connection ${trace.from} to ${trace.to}`}
              onClick={() => {
                if (trace.from && trace.to) {
                  void actions.edit([{ kind: "removeTrace", from: trace.from, to: trace.to }], `remove trace ${trace.from} -> ${trace.to}`)
                }
              }}
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <AddConnection actions={actions} />
    </div>
  )
}

/** Two selectors and Connect: adds a connection between them, then empties the fields. */
function AddConnection({ actions }: { actions: Actions }) {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  return (
    <form
      className="add-connection hairline-t"
      onSubmit={(e) => {
        e.preventDefault()
        if (!from || !to) return
        void actions.edit([{ kind: "addTrace", from, to }], `add trace ${from} -> ${to}`).then((ok) => {
          if (ok) {
            setFrom("")
            setTo("")
          }
        })
      }}
    >
      <label>
        From
        <input placeholder=".R1 > .pin1" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label>
        To
        <input placeholder="net.GND" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <button type="submit" className="primary">
        Connect
      </button>
    </form>
  )
}

export function touches(trace: TraceInfo, part: string | null): boolean {
  if (!part) return false
  return [trace.from, trace.to].some((end) => end !== undefined && partsInSelector(end).includes(part))
}
