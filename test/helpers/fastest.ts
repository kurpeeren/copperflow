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
