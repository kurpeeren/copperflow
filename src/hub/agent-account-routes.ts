// The account page's agent forms: make and revoke personal access tokens, revoke a connected client. A token or grant of
// another user is answered exactly like one that does not exist (404).
import type { IncomingMessage, ServerResponse } from "node:http"
import { checkCurrentPassword, showAccount } from "./account-routes.js"
import { labelOf, MAX_PERSONAL_TOKENS, newToken, PAT_PREFIX } from "./agent-tokens.js"
import { audit, formTokenMatches, type Hub, type Signed } from "./context.js"
import { HubError, readForm, redirect } from "./http.js"
import { hashSecret, newId } from "./secrets.js"

async function checkedForm(req: IncomingMessage, signed: Signed): Promise<Map<string, string>> {
  const form = await readForm(req)
  if (!formTokenMatches(signed, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  return form
}

/** Makes a personal access token and shows it once, on the answer to this form; only its hash is kept. */
export async function createToken(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const form = await checkedForm(req, signed)
  const name = labelOf(form.get("name"))
  if (!name) return showAccount(hub, res, signed, undefined, 400, "A token name has 1 to 100 characters.")
  // Such a token outlives this session, so the current password is asked (the re-authentication limiter applies).
  if (!(await checkCurrentPassword(hub, res, address, signed, form.get("password"), "token-create"))) return
  // The session may have been ended while the password was checked.
  if (hub.store.session(signed.sessionHash, hub.config.now())?.userId !== signed.user.id) throw new HubError(403, "Sign in first.")
  const token = newToken(PAT_PREFIX)
  const id = newId()
  const added = hub.store.tokens.addPersonalToken({ id, hash: hashSecret(token), userId: signed.user.id, name }, MAX_PERSONAL_TOKENS, hub.config.now())
  if (added === "full") return showAccount(hub, res, signed, undefined, 403, `You have ${MAX_PERSONAL_TOKENS} tokens, the most allowed. Revoke one first.`)
  audit(hub, address, signed.user.id, "token-created", id)
  showAccount(hub, res, signed, undefined, 200, undefined, undefined, token)
}

export async function revokeToken(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed, id: string): Promise<void> {
  await checkedForm(req, signed)
  if (!hub.store.tokens.revokePersonalToken(signed.user.id, id)) throw new HubError(404, "There is no such page.")
  hub.agents.closeCredential(`pat:${id}`)
  audit(hub, address, signed.user.id, "token-revoked", id)
  redirect(res, "/account")
}

export async function revokeClient(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed, grantId: string): Promise<void> {
  await checkedForm(req, signed)
  if (!hub.store.tokens.revokeGrant(signed.user.id, grantId)) throw new HubError(404, "There is no such page.")
  hub.agents.closeCredential(`grant:${grantId}`)
  audit(hub, address, signed.user.id, "grant-revoked", grantId)
  redirect(res, "/account")
}
