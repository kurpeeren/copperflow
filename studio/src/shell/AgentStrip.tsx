import { useCallback, useEffect, useState } from "react"
import { subscribe } from "../api"
import { afterActivity, afterClick, afterTime, msUntilHide, NO_STRIP, readActivity, type StripState } from "./agent-strip"
import "./agent-strip.css"

/** Follows the "activity" events and the strip's one timer; agent-strip.ts decides what shows. */
function useAgentStrip(): { state: StripState; dismiss(): void } {
  const [state, setState] = useState<StripState>(NO_STRIP)
  useEffect(
    () =>
      subscribe((event, _file, data) => {
        if (event !== "activity") return
        const activity = readActivity(data)
        if (activity) setState(afterActivity(activity, Date.now()))
      }),
    [],
  )
  useEffect(() => {
    const wait = msUntilHide(state, Date.now())
    if (wait === undefined) return
    const timer = setTimeout(() => setState((current) => afterTime(current, Date.now())), wait)
    return () => clearTimeout(timer)
  }, [state])
  const dismiss = useCallback(() => setState(afterClick), [])
  return { state, dismiss }
}

/** The thin strip under the toolbar: what the agent is doing, with a bar when it knows how far it is. */
export function AgentStrip() {
  const { state, dismiss } = useAgentStrip()
  const strip = state.strip
  if (!strip) return null
  return (
    <div className={`agent-strip ${strip.tone}`} role="status" onClick={dismiss} title={strip.tone === "failed" ? "Click to dismiss" : undefined}>
      <span className="agent-strip-text">{strip.text}</span>
      {strip.fraction !== undefined && (
        <span className="agent-strip-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(strip.fraction * 100)}%` }} />
        </span>
      )}
    </div>
  )
}
