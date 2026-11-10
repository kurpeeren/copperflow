// Which PCB layers are shown, the Layer panel's filter, and the active copper layer. They live in the workspace, above the canvas, so switching
// tabs or files (which remounts the canvas) keeps them for as long as Studio is open.
import { useCallback, useState } from "react"
import { DEFAULT_LAYERS, toggleLayer, togglePour, type ActiveLayer, type LayerFilter, type LayerId, type LayerVisibility } from "./pcb/layers"

export function useLayers() {
  const [layerVisibility, setVisibility] = useState<LayerVisibility>(DEFAULT_LAYERS)
  const [layerFilter, setLayerFilter] = useState<LayerFilter>("all")
  // The copper layer tracks are drawn on (V, the Layer panel's select); top at first, as EasyEDA opens.
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>("top")
  const toggleLayerShown = useCallback((id: LayerId) => setVisibility((now) => toggleLayer(now, id)), [])
  // The copper pours hidden in the Layer panel, by id; every pour shows at first.
  const [hiddenPours, setHiddenPours] = useState<ReadonlySet<string>>(() => new Set())
  const togglePourShown = useCallback((id: string) => setHiddenPours((now) => togglePour(now, id)), [])
  return { layerVisibility, layerFilter, setLayerFilter, toggleLayerShown, activeLayer, setActiveLayer, hiddenPours, togglePourShown }
}
