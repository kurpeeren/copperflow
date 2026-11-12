// Sign up, sign in, sign out and the account page. Answers never tell whether an email exists: an unknown email and a
// wrong password read the same, as do an unknown code, a used code and a taken email.
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  anonymousFormMatches,
  anonymousFormToken,
  audit,
  clearSessionCookie,
  countAttempt,
  formTokenMatches,
  knownDevice,
  passGate,
  rememberDevice,
  startSession,
  withRenewed,
  type Hub,
  type Signed,
} from "./context.js"
import { HubError, readForm, redirect, sendPage } from "./http.js"
import { accountPage, signInPage, signUpPage } from "./pages.js"
import { hashPassword, hashSecret, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, newId, verifyAgainstNothing, verifyPassword } from "./secrets.js"
import { normaliseEmail } from "./store.js"
import { addressKey } from "./limits.js"

const SIGN_IN_FAILED = "The email or password is wrong."
const SIGN_UP_FAILED = "That invite code cannot be used with that email. Check the code, or sign in if you already have an account."
const EMAIL = /^[^\s@<>"'\\]{1,64}@[^\s@<>"'\\]{1,189}$/

function validEmail(text: string | undefined): string | undefined {
  const email = normaliseEmail(text ?? "")
  return email.length <= 254 && EMAIL.test(email) && !/[\u0000-\u001f\u007f]/.test(email) ? email : undefined
}

function passwordProblem(password: string | undefined): string | undefined {
  if (password === undefined || password.length < MIN_PASSWORD_LENGTH) return `The password needs at least ${MIN_PASSWORD_LENGTH} characters.`
  if (password.length > MAX_PASSWORD_LENGTH) return `The password may have at most ${MAX_PASSWORD_LENGTH} characters.`
  return undefined
}

function minutes(seconds: number): string {
  const whole = Math.ceil(seconds / 60)
  return whole === 1 ? "1 minute" : `${whole} minutes`
}

export function showSignIn(hub: Hub, req: IncomingMessage, res: ServerResponse, status = 200, error?: string, headers: Record<string, string | string[]> = {}): void {
  const form = anonymousFormToken(hub, req)
  sendPage(res, status, signInPage(form.token, error), form.cookie ? { ...headers, "set-cookie": form.cookie } : headers)
}

export function showSignUp(hub: Hub, req: IncomingMessage, res: ServerResponse, status = 200, error?: string): void {
  const form = anonymousFormToken(hub, req)
  sendPage(res, status, signUpPage(form.token, error), form.cookie ? { "set-cookie": form.cookie } : {})
}

export async function signIn(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
  const form = await readForm(req)
  if (!anonymousFormMatches(hub, req, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  const email = normaliseEmail(form.get("email") ?? "").slice(0, 254)
  const now = hub.config.now()
  const user = hub.store.userByEmail(email)
  const device = user !== undefined && knownDevice(hub, req, user.id)
  const addressKeyed = addressKey(address)
  // (a) the address, then (b) the email unless this device has signed in to that account before.
  const byAddress = hub.limits.signinAddress.check(addressKeyed, now)
  const byEmail = byAddress.ok && !device ? hub.limits.signinEmail.check(email, now) : ({ ok: true } as const)
  const limited = !byAddress.ok ? byAddress : !byEmail.ok ? byEmail : undefined
  const tooMany = (retryAfterS: number) =>
    showSignIn(hub, req, res, 429, `Too many sign-in attempts. Try again in ${minutes(retryAfterS)}.`, { "retry-after": String(retryAfterS) })
  if (limited && !limited.ok) {
    audit(hub, address, null, byAddress.ok ? "signin-limited-email" : "signin-limited-address")
    return tooMany(limited.retryAfterS)
  }
  // Counted now, before the first await, as if it failed: concurrent attempts cannot pass the check together.
  countAttempt(hub, hub.limits.signinAddress, addressKeyed, now, address)
  if (!device) countAttempt(hub, hub.limits.signinEmail, email, now, address)
  const refund = () => {
    hub.limits.signinAddress.refund(addressKeyed, now)
    if (!device) hub.limits.signinEmail.refund(email, now)
  }
  // (c) strict mode: attempts without the account's device cookie go through the token bucket.
  if (!device && !(await passGate(hub, address))) {
    refund()
    audit(hub, address, null, "signin-limited-strict")
    return tooMany(1)
  }
  const password = form.get("password") ?? ""
  const ok = user ? await verifyPassword(password, user.passwordHash) : await verifyAgainstNothing(password)
  if (!user || !ok) {
    hub.limits.gate.fail(hub.config.now())
    audit(hub, address, user?.id ?? null, "signin-failed")
    return showSignIn(hub, req, res, 401, SIGN_IN_FAILED)
  }
  refund()
  audit(hub, address, user.id, "signin")
  const deviceCookie = rememberDevice(hub, req, user.id)
  redirect(res, "/projects", { "set-cookie": [startSession(hub, user.id), ...(deviceCookie ? [deviceCookie] : [])] })
}

export async function signUp(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
  const form = await readForm(req)
  if (!anonymousFormMatches(hub, req, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  const limit = hub.limits.signupAddress.check(addressKey(address), hub.config.now())
  if (limit.ok) hub.limits.signupAddress.add(addressKey(address), hub.config.now())
  else {
    audit(hub, address, null, "signup-limited")
    sendPage(res, 429, signUpPage(anonymousFormToken(hub, req).token, `Too many sign-up attempts. Try again in ${minutes(limit.retryAfterS)}.`), { "retry-after": String(limit.retryAfterS) })
    return
  }
  const email = validEmail(form.get("email"))
  if (!email) return showSignUp(hub, req, res, 400, "Enter a valid email address.")
  const password = form.get("password")
  const problem = passwordProblem(password)
  if (problem) return showSignUp(hub, req, res, 400, problem)
  const code = (form.get("code") ?? "").trim()
  const passwordHash = await hashPassword(password as string)
  const user = code.length > 0 && code.length <= 200 ? hub.store.signUp(hashSecret(code), { id: newId(), email, passwordHash }, hub.config.now()) : undefined
  if (!user) {
    audit(hub, address, null, "signup-failed")
    return showSignUp(hub, req, res, 400, SIGN_UP_FAILED)
  }
  audit(hub, address, user.id, "signup")
  redirect(res, "/projects", { "set-cookie": startSession(hub, user.id) })
}

/** Ends every session of the user, not only this one. */
export async function signOut(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const form = await readForm(req)
  if (!formTokenMatches(signed, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  hub.store.endSessions(signed.user.id)
  hub.store.forgetDevices(signed.user.id)
  audit(hub, address, signed.user.id, "signout")
  redirect(res, "/", { "set-cookie": clearSessionCookie(hub) })
}

export function showAccount(res: ServerResponse, signed: Signed, renewed?: string, status = 200, error?: string, note?: string): void {
  sendPage(res, status, accountPage({ email: signed.user.email, formToken: signed.formToken }, error, note), withRenewed(renewed))
}

/**
 * Checks the signed-in user's password under its own limiter, keyed on the user id and counting failures only, so the
 * anonymous sign-in route can never use it up; answers the page itself and returns false when wrong or limited.
 */
async function checkCurrentPassword(hub: Hub, res: ServerResponse, address: string, signed: Signed, given: string | undefined, what: string): Promise<boolean> {
  const now = hub.config.now()
  const limited = hub.limits.reauth.check(signed.user.id, now)
  if (!limited.ok) {
    audit(hub, address, signed.user.id, `${what}-limited`)
    sendPage(res, 429, accountPage({ email: signed.user.email, formToken: signed.formToken }, `Too many password attempts. Try again in ${minutes(limited.retryAfterS)}.`), { "retry-after": String(limited.retryAfterS) })
    return false
  }
  // Counted before the await, refunded when right.
  countAttempt(hub, hub.limits.reauth, signed.user.id, now, address)
  if (await verifyPassword(given ?? "", signed.user.passwordHash)) {
    hub.limits.reauth.refund(signed.user.id, now)
    return true
  }
  audit(hub, address, signed.user.id, `${what}-failed`)
  showAccount(res, signed, undefined, 400, "The current password is wrong.")
  return false
}

/** Changes the password and ends every other session: this browser gets a fresh one. */
export async function changePassword(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const form = await readForm(req)
  if (!formTokenMatches(signed, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  if (!(await checkCurrentPassword(hub, res, address, signed, form.get("current"), "password-change"))) return
  const password = form.get("password")
  const problem = passwordProblem(password)
  if (problem) return showAccount(res, signed, undefined, 400, problem)
  hub.store.setPassword(signed.user.id, await hashPassword(password as string))
  hub.store.endSessions(signed.user.id)
  hub.store.forgetDevices(signed.user.id)
  audit(hub, address, signed.user.id, "password-changed")
  redirect(res, "/account", { "set-cookie": startSession(hub, signed.user.id) })
}

/** Deletes the account, its sessions, its projects and their folders, after the email and password are typed. */
export async function deleteAccount(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const form = await readForm(req)
  if (!formTokenMatches(signed, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  if (normaliseEmail(form.get("confirm") ?? "") !== signed.user.email) return showAccount(res, signed, undefined, 400, "Type your email exactly to confirm.")
  if (!(await checkCurrentPassword(hub, res, address, signed, form.get("password"), "account-delete"))) return
  await removeUser(hub, signed.user.id)
  audit(hub, address, signed.user.id, "account-deleted")
  redirect(res, "/", { "set-cookie": clearSessionCookie(hub) })
}

/** Stops the user's workspaces, removes their folders and deletes their rows (sessions and projects go with them). */
export async function removeUser(hub: Pick<Hub, "store" | "files" | "runner">, userId: string): Promise<void> {
  for (const project of hub.store.projects(userId)) await hub.runner.stop(project.id)
  hub.store.endSessions(userId)
  await hub.files.removeUser(userId)
  hub.store.deleteUser(userId)
}
