/**
 * The fastest wall-clock time, in ms, of `times` runs after one warm-up run. Other work on the
 * machine only ever adds time, so the fastest run is the honest figure for the code itself.
 */
export function fastestMs(run: () => void, times: number): number {
  if (!(times >= 1)) throw new Error(`fastestMs needs at least 1 timed run, got ${times}`)
  run()
  const samples = Array.from({ length: times }, () => {
    const start = performance.now()
    run()
    return performance.now() - start
  })
  return Math.min(...samples)
}

/**
 * The fastest of `times` runs, measured again after a pause while it is over `limitMs`, at most `rounds` times; the
 * answer is the fastest run of every round. A machine busy for a second or two slows every run of one round alike, and
 * the next round, after the pause, sees the code's own time again; code that is really slower is over in every round.
 */
export async function fastestWithinMs(run: () => void, times: number, limitMs: number, { rounds = 3, pauseMs = 1000 } = {}): Promise<number> {
  let fastest = Number.POSITIVE_INFINITY
  for (let round = 0; round < rounds; round++) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs))
    fastest = Math.min(fastest, fastestMs(run, times))
    if (fastest < limitMs) break
  }
  return fastest
}
