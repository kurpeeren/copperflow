// Actions a context menu item sends to the open canvas about the thing that was right-clicked. The action names the
// target by id only; the canvas looks the target up, and reads its circuit, when the action runs, so it never works
// from values captured when the menu opened.

export type TargetAction = { kind: "renameLabel"; labelId: string }

export type TargetHandler = (action: TargetAction) => void

export function createTargetActions() {
  let handler: TargetHandler | null = null
  return {
    /** The canvas that answers actions; returns the way to stop answering. */
    answer(next: TargetHandler): () => void {
      handler = next
      return () => {
        if (handler === next) handler = null
      }
    },
    /** False when no canvas answers. */
    send(action: TargetAction): boolean {
      if (!handler) return false
      handler(action)
      return true
    },
  }
}

export const targetActions = createTargetActions()

/** A handler that can be swapped on every render while one subscription keeps calling the newest. */
export function latestHandler(first: TargetHandler) {
  let current = first
  return {
    set(next: TargetHandler): void {
      current = next
    },
    call: (action: TargetAction): void => current(action),
  }
}
