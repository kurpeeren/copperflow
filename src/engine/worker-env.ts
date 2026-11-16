/**
 * The environment of the workers that run circuit code (builds, the router, the placer): empty, so nothing the server
 * process holds (keys, tokens, paths) reaches code that might escape its context. None of them reads the environment.
 */
export const WORKER_ENV: Record<string, string> = {}

/** The heap of a build, route or place worker on a person's own machine. */
export const LOCAL_WORKER_HEAP_MB = 2048
/** The heap every worker started from now on gets. */
export function workerHeap(): number {
  return LOCAL_WORKER_HEAP_MB
}
