import type { SVGProps } from "react"

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

export const WireIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="3.5" cy="12.5" r="1.5" />
    <circle cx="12.5" cy="3.5" r="1.5" />
    <path d="M5 12.5h3.5V3.5H11" />
  </Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </Icon>
)
