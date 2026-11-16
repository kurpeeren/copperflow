import { lockLabel } from "../ai-lock"
import { PadlockIcon, PadlockOpenIcon } from "../icons"
import "./ai-lock.css"

/** The AI lock's control, in the middle of the menu bar: pressed while the agent is driving. */
export function AiLockButton({ closed, onToggle }: { closed: boolean; onToggle(): void }) {
  const { title, hint } = lockLabel(closed)
  const Icon = closed ? PadlockIcon : PadlockOpenIcon
  return (
    <button type="button" className={closed ? "ai-lock closed" : "ai-lock"} aria-pressed={closed} aria-label={`AI lock: ${title}. ${hint}`} title={hint} onClick={onToggle}>
      <Icon className="ai-lock-icon" width={22} height={22} />
      <span className="ai-lock-words">
        <span className="ai-lock-title">{title}</span>
        <span className="ai-lock-hint">{hint}</span>
      </span>
    </button>
  )
}
