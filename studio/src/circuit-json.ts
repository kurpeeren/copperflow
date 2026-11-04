import type { CircuitElement } from "./api"

function find(json: CircuitElement[], type: string, key: string, value: unknown): CircuitElement | undefined {
  return json.find((e) => e.type === type && e[key] === value)
}

function sourceName(json: CircuitElement[], sourceComponentId: unknown): string | undefined {
  const name = find(json, "source_component", "source_component_id", sourceComponentId)?.name
  return typeof name === "string" ? name : undefined
}

export function nameOfPcbComponent(json: CircuitElement[], pcbComponentId: string): string | undefined {
  return sourceName(json, find(json, "pcb_component", "pcb_component_id", pcbComponentId)?.source_component_id)
}

export function nameOfSchematicComponent(json: CircuitElement[], schematicComponentId: string): string | undefined {
  return sourceName(json, find(json, "schematic_component", "schematic_component_id", schematicComponentId)?.source_component_id)
}

export function pcbCenterOf(json: CircuitElement[], name: string): { x: number; y: number } | undefined {
  const source = find(json, "source_component", "name", name)
  const center = find(json, "pcb_component", "source_component_id", source?.source_component_id)?.center as
    | { x: number; y: number }
    | undefined
  return center
}
