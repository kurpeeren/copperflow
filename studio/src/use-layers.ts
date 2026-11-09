// Which PCB layers are shown, and the Layer panel's filter. They live in the workspace, above the canvas, so switching
// tabs or files (which remounts the canvas) keeps them for as long as Studio is open.
import { useCallback, useState } from "react"
import { DEFAULT_LAYERS, toggleLayer, type LayerFilter, type LayerId, type LayerVisibility } from "./pcb/layers"

export function useLayers() {
  const [layerVisibility, setVisibility] = useState<LayerVisibility>(DEFAULT_LAYERS)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>("all")
  const toggleLayerShown = useCallback((id: LayerId) => setVisibility((now) => toggleLayer(now, id)), [])
  return { layerVisibility, layerFilter, setLayerFilter, toggleLayerShown }
}
