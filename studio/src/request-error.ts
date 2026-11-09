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
