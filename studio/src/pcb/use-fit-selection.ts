// View → Fit selection, from the menu and the toolbar: the camera goes to the box around the selected parts as this
// view draws them. With none selected the command is disabled; one the view does not draw is told.
import type { Selection } from "../selection"
import type { FitCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import type { Camera, PartBox, Size } from "./geometry"
import { FIT_PADDING, fitSelectionPlan } from "./view-fit"

interface Input {
  selection: Selection
  boxes: readonly PartBox[]
  size: Size
  setCamera(camera: Camera): void
  notify(text: string): void
}

export function useFitSelection({ selection, boxes, size, setCamera, notify }: Input): void {
  const fitSelection = () => {
    const plan = fitSelectionPlan(boxes, selection.names, size, FIT_PADDING)
    if ("camera" in plan) setCamera(plan.camera)
    else notify(plan.message)
  }
  useCommands({ fitSelection } satisfies Record<FitCommand, () => void>)
}
