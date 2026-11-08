import { useMemo } from "react"
import type { Actions } from "../use-actions"
import { Inspector } from "../Inspector"
import { LeftPanel } from "../LeftPanel"
import type { CanvasProps } from "../pcb/canvas-common"
import { PcbCanvas } from "../pcb/PcbCanvas"
import type { View } from "../pcb/positions"
import { SchematicCanvas } from "../pcb/SchematicCanvas"
import type { useChecks } from "../use-checks"
import type { StudioData } from "../use-studio-data"
import type { useWorkspace } from "../use-workspace"
import { BottomPanel } from "./BottomPanel"
import { DocTabs } from "./DocTabs"
import { buildPageTree, type DocView } from "./page-tree"
import { SideStrip } from "./SideStrip"
import type { LeftStrip, RightStrip } from "./strip-state"
import "./workspace.css"

const LEFT_STRIP: ReadonlyArray<{ id: LeftStrip; label: string }> = [
  { id: "design", label: "Project Design" },
  { id: "library", label: "Common Library" },
]
const RIGHT_STRIP: ReadonlyArray<{ id: RightStrip; label: string }> = [{ id: "properties", label: "Properties" }]

export interface WorkspaceProps {
  data: StudioData
  workspace: ReturnType<typeof useWorkspace>
  checks: ReturnType<typeof useChecks>
  view: View
  onView(view: View): void
  selected: string | null
  onSelect(name: string | null): void
  actions: Actions
  onPlace(part: string): void
  onOpenDocument(file: string, view: DocView): void
  openChecks(): void
}

/** What both canvases take, once there is a design to draw; each adds the rings of its own view. */
function canvasProps({ data, workspace, checks, selected, onSelect, actions }: WorkspaceProps): Omit<CanvasProps, "markers"> | undefined {
  const { build, circuit } = data
  if (!build.design || !circuit) return undefined
  return {
    design: build.design,
    buildId: build.finishedAt,
    // Previews of moves and wires sent before this time are in the design the canvases draw.
    builtFrom: build.startedAt ? Date.parse(build.startedAt) : Number.NEGATIVE_INFINITY,
    circuit,
    actions,
    selected,
    onSelect,
    highlight: workspace.highlight,
    onHighlight: workspace.setHighlight,
    unit: workspace.unit,
    onToggleUnit: workspace.toggleUnit,
    activeViolation: checks.active,
    focus: checks.focus,
    onFocused: checks.focused,
  }
}

/** The document tabs, the open document's canvas and the bottom panel, between the side panels. */
function CenterColumn(props: WorkspaceProps) {
  const { data, workspace, checks, view } = props
  const { build } = data
  const canvas = canvasProps(props)
  return (
    <div className="center">
      <DocTabs file={data.file} view={view} onView={props.onView} />
      <section className="canvas" id="doc-panel" role="tabpanel" aria-labelledby={`doc-tab-${view}`}>
        {!build.design && <p className="empty">{build.status === "failed" ? build.error : "Building the circuit…"}</p>}
        {canvas && view === "pcb" && <PcbCanvas key={data.file} {...canvas} markers={checks.markers.pcb} />}
        {canvas && view === "schematic" && <SchematicCanvas key={data.file} {...canvas} markers={checks.markers.schematic} />}
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
        />
      )}
    </div>
  )
}

/** The row under the toolbar: the strips at the edges, the side panels, and the centre column. */
export function Workspace(props: WorkspaceProps) {
  const { data, workspace, view, selected, onSelect, actions } = props
  const { circuit, build, project, files, file } = data
  const pageTree = useMemo(() => buildPageTree(project, files, file, view), [project, files, file, view])
  return (
    <main className="workspace">
      <SideStrip side="left" tabs={LEFT_STRIP} active={workspace.left.strip} open={workspace.left.open} onClick={workspace.clickLeft} onSelect={workspace.selectLeft} />
      {circuit && (
        <LeftPanel
          circuit={circuit}
          parts={data.parts}
          onPlace={props.onPlace}
          selected={selected}
          onSelect={onSelect}
          actions={actions}
          design={build.design}
          left={workspace.left}
          onSub={workspace.showSub}
          pageTree={pageTree}
          onOpenDocument={props.onOpenDocument}
          focusSearch={workspace.focusSearch}
          onSearchFocused={workspace.searchFocused}
          focusPage={workspace.focusPage}
          onPageFocused={workspace.pageFocused}
          highlight={workspace.highlight}
          onHighlight={workspace.setHighlight}
          hidden={!workspace.leftOpen}
        />
      )}
      <CenterColumn {...props} />
      {circuit && (
        <Inspector
          circuit={circuit}
          build={build}
          parts={data.parts}
          selected={selected}
          onSelect={onSelect}
          actions={actions}
          counts={props.checks.counts}
          onShowChecks={props.openChecks}
          hidden={!workspace.rightOpen}
        />
      )}
      <SideStrip side="right" tabs={RIGHT_STRIP} active={workspace.right.active} open={workspace.right.open} onClick={workspace.clickRight} onSelect={workspace.selectRight} />
    </main>
  )
}
