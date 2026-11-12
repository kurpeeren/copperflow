/**
 * The environment of the workers that run circuit code (builds, the router, the placer): empty, so nothing the server
 * process holds (keys, tokens, paths) reaches code that might escape its context. None of them reads the environment.
 */
export const WORKER_ENV: Record<string, string> = {}

/** The heap of a build, route or place worker on a person's own machine. */
export const LOCAL_WORKER_HEAP_MB = 2048
/** The heap of each worker in a hosted workspace: its container has 512 MB in all (the main thread 160 MB). */
export const HOSTED_WORKER_HEAP_MB = 256

let workerHeapMb = LOCAL_WORKER_HEAP_MB

/** The heap every worker started from now on gets. */
export function workerHeap(): number {
  return workerHeapMb
}

/** Set once by `copperflow workspace`, before anything starts a worker. */
export function useHostedWorkerHeap(): void {
  workerHeapMb = HOSTED_WORKER_HEAP_MB
}
