// The one way a user's access is revoked: every path that revokes (password change, the forced change after a reset,
// "End all sessions", account deletion, and the hub's sweep that carries out the maintainer's reset-password and
// delete-user) calls `revokeUser` and nothing else, so no credential kind can be forgotten on one path.
import { cutUser, type Hub } from "./context.js"

export type RevokingHub = Pick<Hub, "store" | "agents" | "oauth" | "userCuts" | "runner" | "epochs">

/**
 * Ends the user's hub sessions and workspace sessions, forgets their devices, revokes their OAuth grants with every
 * access and refresh token and their personal access tokens, drops their pending OAuth requests and codes, closes
 * their open agent sessions (and so their streams), bumps their revocation epoch, cuts proxied streams and stops
 * their workspaces.
 */
export async function revokeUser(hub: RevokingHub, userId: string): Promise<void> {
  hub.store.endSessions(userId)
  hub.store.forgetDevices(userId)
  hub.store.tokens.revokeUser(userId)
  hub.oauth.forgetUser(userId)
  hub.agents.closeUser(userId)
  await cutUser(hub, userId)
}
