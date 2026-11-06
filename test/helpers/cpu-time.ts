/** Median CPU time (user + system, in ms) of `times` runs. Immune to wall-clock noise from parallel workers. */
export function cpuMedianMs(run: () => void, times: number): number {
  const samples = Array.from({ length: times }, () => {
    const before = process.cpuUsage()
    run()
    const delta = process.cpuUsage(before)
    return (delta.user + delta.system) / 1000
  }).sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] as number
}
