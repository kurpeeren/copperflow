import { SchematicViewer } from "@tscircuit/schematic-viewer"
import { useState, type ComponentProps } from "react"
import type { CircuitElement } from "./api"
import type { Actions } from "./App"
import { nameOfSchematicComponent, selectorOfSchematicPort } from "./circuit-json"
import { WireIcon } from "./icons"
import { useHeight } from "./useHeight"
import { useHideVendorLabels } from "./useHideVendorLabels"

/** Schematic colours matching the workspace: graphite sheet, silkscreen symbols, copper wires. */
const SCHEMATIC_COLORS = {
  schematic: {
    background: "#1b1e23",
    grid: "#262a31",
    grid_axes: "#30353d",
    component_body: "#22262c",
    component_outline: "#d9d4c7",
    pin: "#d9d4c7",
    pin_name: "#e9e6df",
    pin_number: "#959ca6",
    reference: "#e0a46a",
    value: "#959ca6",
    fields: "#959ca6",
    wire: "#c98a4b",
    junction: "#e0a46a",
    no_connect: "#e5675e",
    net_name: "#e9e6df",
    label_global: "#6ea8d6",
    label_local: "#6ea8d6",
    label_background: "#22262c",
    note: "#959ca6",
  },
}

interface Props {
  json: CircuitElement[]
  actions: Actions
  onSelect(name: string): void
}

/** The schematic: click a part to select it; in wiring mode, click two pins to connect them. */
export function SchematicPane({ json, actions, onSelect }: Props) {
  const { ref, height } = useHeight<HTMLDivElement>()
  useHideVendorLabels()
  const [wiring, setWiring] = useState(false)
  const [first, setFirst] = useState<string | null>(null)

  const onPortClicked = ({ schematicPortId }: { schematicPortId: string }) => {
    if (!wiring) return
    const selector = selectorOfSchematicPort(json, schematicPortId)
    if (!selector) return actions.notify("This pin cannot be connected from the Studio")
    if (!first) return setFirst(selector)
    if (first === selector) return setFirst(null)
    setFirst(null)
    void actions.edit([{ kind: "addTrace", from: first, to: selector }], `connect ${first} to ${selector}`)
  }

  return (
    <div className={`pane with-toolbar${wiring ? " wiring" : ""}`}>
      <div className="pane-toolbar">
        <button
          className={wiring ? "active" : ""}
          onClick={() => {
            setWiring(!wiring)
            setFirst(null)
          }}
        >
          <WireIcon /> {wiring ? "Stop wiring" : "Wire pins"}
        </button>
        {wiring && <span>{first ? `From ${first}: click the second pin` : "Click the first pin"}</span>}
        {!wiring && <span>Click a part to inspect it.</span>}
      </div>
      <div className="pane-body" ref={ref}>
        <SchematicViewer
          circuitJson={json as ComponentProps<typeof SchematicViewer>["circuitJson"]}
          containerStyle={{ height, background: SCHEMATIC_COLORS.schematic.background }}
          colorOverrides={SCHEMATIC_COLORS}
          clickToInteractEnabled={false}
          showSchematicPorts={wiring}
          onSchematicPortClicked={onPortClicked}
          onSchematicComponentClicked={({ schematicComponentId }) => {
            const name = nameOfSchematicComponent(json, schematicComponentId)
            if (name) onSelect(name)
          }}
        />
      </div>
    </div>
  )
}
