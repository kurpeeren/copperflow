/**
 * The environment of the workers that run circuit code (builds, the router, the placer): empty, so nothing the server
 * process holds (keys, tokens, paths) reaches code that might escape its context. None of them reads the environment.
 */
export const WORKER_ENV: Record<string, string> = {}
