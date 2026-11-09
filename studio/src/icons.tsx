import type { SVGProps } from "react"
import type { ToolIconName } from "./shell/toolbar"

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Icon>
)

export const UnlockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
  </Icon>
)

export const RotateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" />
    <path d="M13 2.5v3h-3" />
  </Icon>
)

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
)

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 3.5 3 6l2.5 2.5" />
    <path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H7" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </Icon>
)

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 4.5 3.5 3.5L6 11.5" />
  </Icon>
)

function ToolIcon({ children, ...props }: IconProps) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

/** The Layer panel's eye: open when the layer is shown, struck through when it is hidden. */
export const EyeIcon = ({ off, ...p }: IconProps & { off?: boolean }) => (
  <ToolIcon width={16} height={16} {...p}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 4l16 16" />}
  </ToolIcon>
)

const undo = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M8 5 4 9l4 4" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-4" />
  </ToolIcon>
)
/** Undo's arrow, mirrored. */
const redo = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M16 5l4 4-4 4" />
    <path d="M20 9H10a6 6 0 0 0 0 12h4" />
  </ToolIcon>
)
const zoomIn = (p: IconProps) => (
  <ToolIcon {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5M10.5 8v5M8 10.5h5" />
  </ToolIcon>
)
const zoomOut = (p: IconProps) => (
  <ToolIcon {...p}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5M8 10.5h5" />
  </ToolIcon>
)
const fit = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    <rect x="9" y="9" width="6" height="6" />
  </ToolIcon>
)
/** Fit all's corners round a small box: the selection alone, filled. */
const fitSelection = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    <rect x="9" y="9" width="6" height="6" fill="currentColor" />
  </ToolIcon>
)
/** A dashed box with a corner arrow: drag a box to zoom to it. */
const fitArea = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M4 8V4h4M12 4h4M20 8V4h-4M4 12v4M20 12v4" strokeDasharray="0.1 3.4" />
    <rect x="4" y="4" width="16" height="16" strokeDasharray="3 3" />
    <path d="m11 11 7 7M18 13v5h-5" />
  </ToolIcon>
)
const component = (p: IconProps) => (
  <ToolIcon {...p}>
    <rect x="7" y="6" width="10" height="12" rx="1" />
    <path d="M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />
  </ToolIcon>
)
const wire = (p: IconProps) => (
  <ToolIcon {...p}>
    <circle cx="5" cy="18" r="2" />
    <circle cx="19" cy="6" r="2" />
    <path d="M7 18h6V6h4" />
  </ToolIcon>
)
const netLabel = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M3 12h5" />
    <path d="M8 7h12v10H8l-3-5z" />
    <path d="M12 12h5" />
  </ToolIcon>
)
const ground = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M12 4v8M5 12h14M8 16h8M10.5 20h3" />
  </ToolIcon>
)
const power = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M12 21V8M6 8h12M12 3v5" />
    <path d="M6 8l6-5 6 5" />
  </ToolIcon>
)
const rotate = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M19 12a7 7 0 1 1-2.2-5.1" />
    <path d="M19 4v4.5h-4.5" />
  </ToolIcon>
)
/** Rotate's arrow, mirrored: a clockwise turn. */
const rotateRight = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M5 12a7 7 0 1 0 2.2-5.1" />
    <path d="M5 4v4.5h4.5" />
  </ToolIcon>
)
/** A magnet over grid dots: positions are drawn to the grid. */
const snap = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z" />
    <path d="M6 7.5h4M14 7.5h4" />
  </ToolIcon>
)
const grid = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01" strokeWidth="2.5" />
  </ToolIcon>
)
const alignLeft = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M4 3v18" />
    <rect x="8" y="6" width="12" height="5" rx="1" />
    <rect x="8" y="14" width="7" height="5" rx="1" />
  </ToolIcon>
)
const distributeH = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M4 3v18M20 3v18" />
    <rect x="9" y="7" width="6" height="10" rx="1" />
  </ToolIcon>
)
const check = (p: IconProps) => (
  <ToolIcon {...p}>
    <path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </ToolIcon>
)

/** The toolbar's icons, by the name toolbar.ts gives each button. */
export const TOOL_ICONS: Record<ToolIconName, (props: IconProps) => React.JSX.Element> = { undo, redo, zoomIn, zoomOut, fit, fitSelection, fitArea, component, wire, netLabel, ground, power, rotate, rotateRight, snap, check, grid, alignLeft, distributeH }
