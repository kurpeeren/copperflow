import { startStudio, type Studio, type StudioOptions } from "../../src/studio/server.js"

/**
 * Ports that `fetch` refuses to talk to (the WHATWG "bad ports" list, from 1024 up). Where the
 * operating system hands out ports from 1024, a server on port 0 can land on one of them.
 */
const FETCH_BLOCKED_PORTS = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
])
const MAX_PORT_TRIES = 8
const MAX_SEND_ATTEMPTS = 6

export function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.has(port)
}

/** Starts a studio on a free port that `fetch` is willing to use. */
export async function startReachableStudio(options: Omit<StudioOptions, "port">): Promise<Studio> {
  for (let tries = 1; ; tries++) {
    const studio = await startStudio({ ...options, port: 0 })
    if (!isFetchBlockedPort(Number(new URL(studio.url).port))) return studio
    await studio.close()
    if (tries >= MAX_PORT_TRIES) throw new Error(`the system keeps handing out ports that fetch refuses (${tries} tries)`)
  }
}

/**
 * True for a TCP connect that the operating system gave up on (`ETIMEDOUT`, `syscall: "connect"`),
 * as `fetch` or `http.request` report it. No byte of the request was sent, so sending it again is safe.
 */
export function isLostConnect(error: unknown): boolean {
  const failure = error as { code?: unknown; syscall?: unknown; cause?: unknown } | undefined
  if (failure?.code === "ETIMEDOUT" && failure.syscall === "connect") return true
  return failure?.cause !== undefined && failure.cause !== error && isLostConnect(failure.cause)
}

/**
 * Runs `send`, and runs it again while it fails with a lost connect. On some Windows hosts a
 * connection to a loopback listener is sometimes lost when the machine is busy: the server sits in
 * SYN_RECEIVED and the client fails with ETIMEDOUT after about 300 ms, whatever the program does.
 * Any other error, and the last lost connect, are thrown as they are.
 */
export async function retryLostConnect<T>(send: () => Promise<T>, attempts = MAX_SEND_ATTEMPTS): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send()
    } catch (error) {
      if (!isLostConnect(error) || attempt >= attempts) throw error
    }
  }
}
