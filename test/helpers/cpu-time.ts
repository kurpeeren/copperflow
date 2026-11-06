const MICROSECONDS_PER_MS = 1000

/**
 * Median CPU time (user + system, in ms) of `times` runs of this process, including its GC and JIT threads.
 * Ignores wall-clock waiting, but only other processes are excluded: it needs each test file in its own process.
 */
export function cpuMedianMs(run: () => void, times: number): number {
  const samples = Array.from({ length: times }, () => {
    const before = process.cpuUsage()
    run()
    const delta = process.cpuUsage(before)
    return (delta.user + delta.system) / MICROSECONDS_PER_MS
  }).sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] as number
}
