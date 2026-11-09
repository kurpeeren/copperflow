import { useEffect, useRef } from "react"
import { latestHandler, targetActions, type TargetHandler } from "./target-actions"

/** While mounted, answers target actions with the handler of the latest render. */
export function useTargetActions(handler: TargetHandler): void {
  const latest = useRef(latestHandler(handler))
  latest.current.set(handler)
  useEffect(() => targetActions.answer((action) => latest.current.call(action)), [])
}
