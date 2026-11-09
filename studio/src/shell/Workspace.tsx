import { useMemo } from "react"
import type { Actions } from "../use-actions"
import { Inspector } from "../Inspector"
import { LeftPanel } from "../LeftPanel"
import type { CanvasProps } from "../pcb/canvas-common"
import { PcbCanvas } from "../pcb/PcbCanvas"
import type { View } from "../pcb/positions"
import { SchematicCanvas } from "../pcb/SchematicCanvas"
import type { Selection, SelectionChange } from "../selection"
import { FindBox } from "../FindBox"
import { findStatus } from "../find"
import type { useChecks } from "../use-checks"
import type { FindState } from "../use-find"
import type { StudioData } from "../use-studio-data"
import type { useWorkspace } from "../use-workspace"
import { BottomPanel } from "./BottomPanel"
import { ContextMenu } from "./ContextMenu"
import { DocTabs } from "./DocTabs"
import type { CommandId } from "./menus"
import { buildPageTree, type DocView } from "./page-tree"
import { FilterPanel } from "./FilterPanel"
import { LayerPanel } from "./LayerPanel"
import { SideStrip } from "./SideStrip"
import { useContextMenu, type ContextMenuState } from "./use-context-menu"
import { rightTabIds, type LeftStrip, type RightStrip } from "./strip-state"
import "./workspace.css"

const LEFT_STRIP: ReadonlyArray<{ id: LeftStrip; label: string }> = [
  { id: "design", label: "Project Design" },
  { id: "library", label: "Common Library" },
]
const RIGHT_LABELS: Record<RightStrip, string> = { properties: "Properties", layer: "Layer", filter: "Filter" }

/** The right strip's tabs for the open document: Layer only on the PCB. */
const rightStrip = (view: View) => rightTabIds(view).map((id) => ({ id, label: RIGHT_LABELS[id] }))

export interface WorkspaceProps {
  data: StudioData
  workspace: ReturnType<typeof useWorkspace>
  checks: ReturnType<typeof useChecks>
  find: FindState
  view: View
  onView(view: View): void
  selection: Selection
  onSelect(change: SelectionChange): void
  actions: Actions
  /** Runs a menu command, as the menu bar does. */
  run(command: CommandId): void
  onPlace(part: string): void
  onOpenDocument(file: string, view: DocView): void
  openChecks(): void
}

/** What both canvases take, once there is a design to draw; each adds the rings of its own view. */
function canvasProps({ data, workspace, checks, selection, onSelect, actions }: WorkspaceProps, onContextMenu: ContextMenuState["show"]): Omit<CanvasProps, "markers" | "gridStyle" | "gridStep" | "snap" | "onGridStep"> | undefined {
  const { build, circuit } = data
  if (!build.design || !circuit) return undefined
  return {
    design: build.design,
    buildId: build.finishedAt,
    buildStatus: build.status,
    builtMark: build.startMark,
    project: data.project,
    // Previews of moves and wires sent before this time are in the design the canvases draw.
    builtFrom: build.startedAt ? Date.parse(build.startedAt) : Number.NEGATIVE_INFINITY,
    circuit,
    actions,
    selection,
    onSelect,
    highlight: workspace.highlight,
    onHighlight: workspace.setHighlight,
    unit: workspace.unit,
    onToggleUnit: workspace.toggleUnit,
    activeViolation: checks.active,
    focus: checks.focus,
    onFocused: checks.focused,
    layers: workspace.layerVisibility,
    pickFilter: workspace.pickFilter,
    onContextMenu,
    onOpenProperties: (target) => {
      onSelect((current) => {
        if (target.kind === "wire") return current.onlyWire(target.id)
        return target.kind === "drawing" ? current.onlyDrawing(target.id) : current.only(target.name)
      })
      workspace.openProperties()
    },
  }
}

/** A canvas's own grid style and Grid step, and the setter bound to its view. */
function gridProps(workspace: WorkspaceProps["workspace"], view: View) {
  return { gridStyle: workspace.gridStyles[view], gridStep: workspace.gridSteps[view], snap: workspace.snap, onGridStep: (step: number) => workspace.changeGridStep(view, step) }
}

/** The document tabs, the open document's canvas and the bottom panel, between the side panels. */
function CenterColumn(props: WorkspaceProps & { onContextMenu: ContextMenuState["show"] }) {
  const { data, workspace, checks, find, view } = props
  const { build } = data
  const canvas = canvasProps(props, props.onContextMenu)
  return (
    <div className="center">
      <DocTabs file={data.file} view={view} onView={props.onView} />
      <section className="canvas" id="doc-panel" role="tabpanel" aria-labelledby={`doc-tab-${view}`} tabIndex={-1}>
        {!build.design && <p className="empty">{build.status === "failed" ? build.error : "Building the circuit…"}</p>}
        {canvas && view === "pcb" && <PcbCanvas key={data.file} {...canvas} {...gridProps(workspace, "pcb")} markers={checks.markers.pcb} />}
        {canvas && view === "schematic" && <SchematicCanvas key={data.file} {...canvas} {...gridProps(workspace, "schematic")} markers={checks.markers.schematic} />}
        {find.box.open && <FindBox text={find.box.text} seq={find.box.seq} onText={find.setText} onSearch={find.search} onClose={find.close} status={findStatus(find.results.query, find.results.rows.length)} />}
      </section>
      {workspace.bottom.open && (
        <BottomPanel
          tab={workspace.bottom.tab}
          parts={data.parts}
          onPlace={props.onPlace}
          history={data.history}
          actions={props.actions}
          built={build.design !== undefined}
          buildError={build.status === "failed" ? (build.error ?? "The build failed.") : undefined}
          rows={checks.rows}
          counts={checks.counts}
          active={checks.active}
          onPick={checks.pick}
          find={find.results}
        />
      )}
    </div>
  )
}

/** The left panel (Project Design or Common Library), once the circuit has loaded. */
function LeftSide({ data, workspace, view, selection, onSelect, actions, onPlace, onOpenDocument }: WorkspaceProps) {
  const { circuit, build, project, files, file } = data
  const pageTree = useMemo(() => buildPageTree(project, files, file, view), [project, files, file, view])
  if (!circuit) return null
  return (
    <LeftPanel
      circuit={circuit}
      parts={data.parts}
      onPlace={onPlace}
      selection={selection}
      onSelect={onSelect}
      actions={actions}
      design={build.design}
      left={workspace.left}
      onSub={workspace.showSub}
      pageTree={pageTree}
      onOpenDocument={onOpenDocument}
      focusSearch={workspace.focusSearch}
      onSearchFocused={workspace.searchFocused}
      focusPage={workspace.focusPage}
      onPageFocused={workspace.pageFocused}
      highlight={workspace.highlight}
      onHighlight={workspace.setHighlight}
      hidden={!workspace.leftOpen}
    />
  )
}

/** The right panel: Properties, the Layer panel (PCB only) or the Filter panel, once the circuit has loaded. Properties stays mounted behind the Layer tab, so its open sections are kept. */
function RightSide({ data, workspace, checks, selection, onSelect, actions, run, openChecks, view }: WorkspaceProps) {
  if (!data.circuit) return null
  const { right } = workspace
  const layerOpen = right.open && right.active === "layer"
  const filterOpen = right.open && right.active === "filter"
  const keepouts = data.build.design?.pcb.board?.keepouts ?? []
  return (
    <>
      <Inspector
        circuit={data.circuit}
        build={data.build}
        parts={data.parts}
        selection={selection}
        onSelect={onSelect}
        actions={actions}
        run={run}
        counts={checks.counts}
        onShowChecks={openChecks}
        hidden={!right.open || right.active !== "properties"}
        focusField={workspace.focusField}
        onFieldFocused={workspace.fieldFocused}
      />
      {layerOpen && <LayerPanel visibility={workspace.layerVisibility} filter={workspace.layerFilter} hasKeepouts={keepouts.length > 0} onFilter={workspace.setLayerFilter} onToggle={workspace.toggleLayerShown} />}
      {filterOpen && <FilterPanel view={view} filter={workspace.pickFilter} onToggle={workspace.togglePickable} />}
    </>
  )
}

/** The row under the toolbar: the strips at the edges, the side panels, and the centre column. */
export function Workspace(props: WorkspaceProps) {
  const { data, workspace, selection, onSelect } = props
  const contextMenu = useContextMenu({ circuit: data.circuit, design: data.build.design, selection, onSelect, run: props.run, openProperties: workspace.openProperties, onHighlight: workspace.setHighlight })
  return (
    <main className="workspace">
      <SideStrip side="left" tabs={LEFT_STRIP} active={workspace.left.strip} open={workspace.left.open} onClick={workspace.clickLeft} onSelect={workspace.selectLeft} />
      <LeftSide {...props} />
      <CenterColumn {...props} onContextMenu={contextMenu.show} />
      <RightSide {...props} />
      <SideStrip side="right" tabs={rightStrip(props.view)} active={workspace.right.active} open={workspace.right.open} onClick={workspace.clickRight} onSelect={workspace.selectRight} />
      {contextMenu.open && <ContextMenu entries={contextMenu.open.entries} at={contextMenu.open.at} onRun={contextMenu.runItem} onClose={contextMenu.close} />}
    </main>
  )
}
