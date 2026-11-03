import { SchematicViewer } from "@tscircuit/schematic-viewer"
import { useState, type ComponentProps } from "react"
import type { CircuitElement } from "./api"
import type { Actions } from "./App"
import { nameOfSchematicComponent, selectorOfSchematicPort } from "./circuit-json"
import { useHeight } from "./useHeight"

interface Props {
  json: CircuitElement[]
  actions: Actions
  onSelect(name: string): void
}

/** The schematic: click a part to select it; in wiring mode, click two pins to connect them. */
export function SchematicPane({ json, actions, onSelect }: Props) {
  const { ref, height } = useHeight<HTMLDivElement>()
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
          {wiring ? "Stop wiring" : "Wire pins"}
        </button>
        {wiring && <span>{first ? `From ${first}: click the second pin` : "Click the first pin"}</span>}
      </div>
      <div className="pane-body" ref={ref}>
        <SchematicViewer
          circuitJson={json as ComponentProps<typeof SchematicViewer>["circuitJson"]}
          containerStyle={{ height }}
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
