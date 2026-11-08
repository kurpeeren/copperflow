// The command bus: the menu bar and the toolbar send a command, and the open canvas (or the app) runs it, the
// same way its keys do. A handler returns true when it took the command.
import { useEffect, useRef } from "react"
import type { CommandId } from "./menus.js"

type Handler = (command: CommandId) => boolean

const handlers = new Set<Handler>()

export function subscribe(handler: Handler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** Runs the command in the first handler that takes it; false when none did. */
export function send(command: CommandId): boolean {
  for (const handler of handlers) if (handler(command)) return true
  return false
}

/** While mounted, runs the commands in `table`; the table may change on every render. */
export function useCommands(table: Partial<Record<CommandId, () => void>>): void {
  const ref = useRef(table)
  ref.current = table
  useEffect(
    () =>
      subscribe((command) => {
        const run = ref.current[command]
        if (!run) return false
        run()
        return true
      }),
    [],
  )
}
