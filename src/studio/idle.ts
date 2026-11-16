// The idle stop: a Studio no browser tab has watched for a while calls onIdle once.

export interface IdleWatch {
  /** The number of open event streams changed. */
  streams(count: number): void
  stop(): void
}

/** Calls onIdle once after `ms` in a row with no open event stream; the period starts now. */
export function watchIdle(ms: number, onIdle: () => void): IdleWatch {
  let timer: NodeJS.Timeout | undefined
  let done = false
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const arm = () => {
    clear()
    timer = setTimeout(() => {
      done = true
      onIdle()
    }, ms)
  }
  arm()
  return {
    streams(count) {
      if (done) return
      if (count === 0) arm()
      else clear()
    },
    stop() {
      done = true
      clear()
    },
  }
}
