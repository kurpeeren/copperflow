// The words Studio shows for a request the server refused.

/** Shown when the server no longer knows this tab's session key, as after `copperflow studio` restarts. */
export const STALE_KEY_MESSAGE = "This tab's key is out of date. Open the address printed by `copperflow studio` again."

/** The message for a failed request: the out of date key in plain words, else the server's own words. */
export function requestErrorText(status: number, serverError: string | undefined): string {
  if (status === 403 && /session token/i.test(serverError ?? "")) return STALE_KEY_MESSAGE
  return serverError ?? `Request failed (${status})`
}

/** Whether a failure message is the out of date key, which stops every later request too. */
export function isStaleKey(message: string): boolean {
  return message === STALE_KEY_MESSAGE
}

/** Shown when a request cannot reach the server at all, as after the `copperflow studio` process stopped. */
export const SERVER_GONE_MESSAGE = 'The copperflow Studio server is not answering. Start "copperflow studio" again in the project folder, then reload this page.'

/** The words for an error a request threw: a network failure (fetch's TypeError) is the server being gone. */
export function networkErrorText(error: unknown): string {
  if (error instanceof TypeError) return SERVER_GONE_MESSAGE
  return error instanceof Error ? error.message : String(error)
}
