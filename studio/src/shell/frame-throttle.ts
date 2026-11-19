// Coalesces a stream of values into at most one run per animation frame, keeping the newest. A splitter drag sends a
// pointer position on every move event, often several per frame; resizing the panels once per frame is enough, and
// the canvases then redraw once per frame too. Plain TypeScript with the clock passed in, so the tests drive frames.

/** The browser's frame clock: requestAnimationFrame and cancelAnimationFrame. */
export interface FrameClock {
  request(callback: () => void): number
  cancel(handle: number): void
}

export interface FrameThrottle<T> {
  /** Keeps `value` as the newest and asks for a frame, unless one is already asked for. */
  push(value: T): void
  /** Runs the waiting value now, if any, and drops its frame: the last move of a drag lands before the drop. */
  flush(): void
  /** Drops the waiting value and its frame. */
  cancel(): void
}

/** The page's own frame clock. */
export const animationFrames = (): FrameClock => ({
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
})

export function frameThrottle<T>(clock: FrameClock, run: (value: T) => void): FrameThrottle<T> {
  let waiting: { value: T } | undefined
  let handle: number | undefined
  const take = () => {
    const due = waiting
    waiting = undefined
    if (due) run(due.value)
  }
  const drop = () => {
    if (handle !== undefined) clock.cancel(handle)
    handle = undefined
  }
  return {
    push(value) {
      waiting = { value }
      if (handle !== undefined) return
      handle = clock.request(() => {
        handle = undefined
        take()
      })
    },
    flush() {
      drop()
      take()
    },
    cancel() {
      drop()
      waiting = undefined
    },
  }
}
