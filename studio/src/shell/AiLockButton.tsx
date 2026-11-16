import { lockLabel } from "../ai-lock"
import { PadlockIcon, PadlockOpenIcon } from "../icons"
import "./ai-lock.css"

/** The AI lock's control, a band above the canvas: large and pressed while the agent is driving, a thin line while open. */
export function AiLockButton({ closed, onToggle }: { closed: boolean; onToggle(): void }) {
  const { title, hint } = lockLabel(closed)
  const Icon = closed ? PadlockIcon : PadlockOpenIcon
  const size = closed ? 34 : 16
  return (
    <button type="button" className={closed ? "ai-lock closed" : "ai-lock"} aria-pressed={closed} aria-label={`AI lock: ${title}. ${hint}`} title={hint} onClick={onToggle}>
      <Icon className="ai-lock-icon" width={size} height={size} />
      <span className="ai-lock-words">
        <span className="ai-lock-title">{title}</span>
        <span className="ai-lock-hint">{hint}</span>
      </span>
    </button>
  )
}
