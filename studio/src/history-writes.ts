// Undo and Redo write the circuit file too, but they are the app's commands, not a canvas's keys. Each one is
// announced here as it is sent, so the open canvas's key session (key-session.ts) waits for the build that read it
// before a Rotate or an arrow press goes. Plain TypeScript, so the tests can run it.

/** Whether the write went through, and the server's mark of it (LiveProject.nextMark). */
export interface WriteOutcome {
  ok: boolean
  mark?: number
}

type Listener = (outcome: Promise<WriteOutcome>) => void

const listeners = new Set<Listener>()

/** Hears every Undo and Redo as it is sent; returns the way to stop. */
export function onHistoryWrite(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tells the listeners that an Undo or Redo was sent, with its outcome to come; returns that outcome. */
export function announceHistoryWrite(outcome: Promise<WriteOutcome>): Promise<WriteOutcome> {
  for (const listener of listeners) listener(outcome)
  return outcome
}
