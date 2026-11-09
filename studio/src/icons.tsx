// The Studio's icons as components. The glyphs are data in icon-shapes.ts and are drawn by icon-svg.ts, so the
// toolbar, the menus and the Properties buttons share one 16px family.
import type { JSX } from "react"
import { iconSvg, type IconProps } from "./icon-svg"
import type { ToolIconName } from "./shell/toolbar"

export const LockIcon = (p: IconProps) => iconSvg("lock", p)
export const UnlockIcon = (p: IconProps) => iconSvg("unlock", p)
export const RotateIcon = (p: IconProps) => iconSvg("rotate", p)
export const TrashIcon = (p: IconProps) => iconSvg("trash", p)
export const UndoIcon = (p: IconProps) => iconSvg("undo", p)
export const CloseIcon = (p: IconProps) => iconSvg("close", p)
export const ChevronIcon = (p: IconProps) => iconSvg("chevron", p)

/** The Layer panel's eye: open when the layer is shown, struck through when it is hidden. */
export const EyeIcon = ({ off, ...p }: IconProps & { off?: boolean }) => (off ? iconSvg("eyeOff", p) : iconSvg("eye", p))

const tool = (name: ToolIconName) => (props: IconProps) => iconSvg(name, props)

/** The toolbar's icons, by the name toolbar.ts gives each button; each is the glyph of the same name. */
export const TOOL_ICONS: Record<ToolIconName, (props: IconProps) => JSX.Element> = {
  undo: tool("undo"),
  redo: tool("redo"),
  zoomIn: tool("zoomIn"),
  zoomOut: tool("zoomOut"),
  fit: tool("fit"),
  fitSelection: tool("fitSelection"),
  fitArea: tool("fitArea"),
  component: tool("component"),
  wire: tool("wire"),
  netLabel: tool("netLabel"),
  ground: tool("ground"),
  power: tool("power"),
  rotate: tool("rotate"),
  rotateRight: tool("rotateRight"),
  snap: tool("snap"),
  check: tool("check"),
  grid: tool("grid"),
  alignLeft: tool("alignLeft"),
  distributeH: tool("distributeH"),
  polyline: tool("polyline"),
  arc: tool("arc"),
  circle: tool("circle"),
  rectangle: tool("rectangle"),
  text: tool("text"),
  bus: tool("bus"),
}
