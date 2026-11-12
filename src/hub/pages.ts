// The hub's pages: server-rendered HTML with no script at all. Every piece of text that did not come from this file
// goes through `esc`; attributes are always double-quoted.
import type { Project } from "./store.js"

export const STYLESHEET = `*{box-sizing:border-box}
body{margin:0;font:15px/1.5 system-ui,sans-serif;color:#1d232a;background:#f5f6f7}
header{display:flex;gap:16px;align-items:center;padding:10px 20px;background:#1d232a;color:#fff}
header a{color:#fff}header form{margin-left:auto}
main{max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px}
form.stack{display:grid;gap:10px;max-width:420px}
label{display:grid;gap:4px}
input{font:inherit;padding:6px 8px;border:1px solid #9aa3ad;border-radius:4px}
button{font:inherit;padding:6px 14px;border:1px solid #1d232a;border-radius:4px;background:#1d232a;color:#fff;cursor:pointer}
button.quiet{background:#fff;color:#1d232a}
.error{padding:8px 12px;border-left:4px solid #b3261e;background:#fbeaea}
.note{padding:8px 12px;border-left:4px solid #2a6bb3;background:#eaf1fb}
table{border-collapse:collapse;width:100%}td,th{padding:6px;border-bottom:1px solid #d5d9de;text-align:left;vertical-align:top}
td form{display:inline-flex;gap:4px;margin:2px 0}
footer{max-width:760px;margin:40px auto;padding:0 16px;color:#5b6570;font-size:13px}
@media (max-width:600px){header{flex-wrap:wrap}td form{display:flex;flex-wrap:wrap}}
`

/** Escapes text for HTML element content and double-quoted attributes. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)
}

export interface Viewer {
  email: string
  formToken: string
}

function hidden(token: string): string {
  return `<input type="hidden" name="form" value="${esc(token)}">`
}

export function layout(title: string, body: string, viewer?: Viewer): string {
  const nav = viewer
    ? `<a href="/projects">Projects</a><a href="/account">Account</a><form method="post" action="/signout">${hidden(viewer.formToken)}<button class="quiet" type="submit">Sign out</button></form>`
    : `<a href="/signin">Sign in</a><a href="/signup">Sign up</a>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - copperflow</title><link rel="stylesheet" href="/static/hub.css"></head>
<body><header><strong>copperflow</strong>${nav}</header><main>${body}</main>
<footer><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer></body></html>`
}

function message(error?: string, note?: string): string {
  return `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}${note ? `<p class="note">${esc(note)}</p>` : ""}`
}

export function signInPage(formToken: string, error?: string): string {
  return layout(
    "Sign in",
    `<h1>Sign in</h1>${message(error)}
<form class="stack" method="post" action="/signin">${hidden(formToken)}
<label>Email <input type="email" name="email" autocomplete="username" required maxlength="254"></label>
<label>Password <input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label>
<button type="submit">Sign in</button></form>
<p>No account yet? <a href="/signup">Sign up with an invite code</a>.</p>`,
  )
}

export function signUpPage(formToken: string, error?: string): string {
  return layout(
    "Sign up",
    `<h1>Sign up</h1><p>copperflow is in a closed beta: you need an invite code.</p>${message(error)}
<form class="stack" method="post" action="/signup">${hidden(formToken)}
<label>Invite code <input name="code" required maxlength="200" autocomplete="off"></label>
<label>Email <input type="email" name="email" autocomplete="username" required maxlength="254"></label>
<label>Password (at least 10 characters) <input type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="1024"></label>
<button type="submit">Create my account</button></form>`,
  )
}

export function projectsPage(viewer: Viewer, projects: readonly Project[], usage: { projects: number; maxProjects: number; bytes: number; maxBytes: number }, error?: string, note?: string): string {
  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1)
  const rows = projects
    .map(
      (p) => `<tr><td><a href="/p/${esc(p.id)}/">${esc(p.name)}</a></td><td>
<a href="/projects/${esc(p.id)}/download">Download</a>
<form method="post" action="/projects/${esc(p.id)}/rename">${hidden(viewer.formToken)}<input name="name" required maxlength="100" aria-label="New name" value="${esc(p.name)}"><button class="quiet" type="submit">Rename</button></form>
<form method="post" action="/projects/${esc(p.id)}/delete">${hidden(viewer.formToken)}<input name="confirm" required maxlength="100" aria-label="Type the project's name to delete it" placeholder="Type its name to delete"><button class="quiet" type="submit">Delete</button></form>
</td></tr>`,
    )
    .join("\n")
  return layout(
    "Projects",
    `<h1>Projects</h1>${message(error, note)}
<p>${usage.projects} of ${usage.maxProjects} projects, ${mb(usage.bytes)} of ${mb(usage.maxBytes)} MB used.</p>
${projects.length ? `<table><tbody>${rows}</tbody></table>` : "<p>No projects yet.</p>"}
<h2>New project</h2>
<form class="stack" method="post" action="/projects">${hidden(viewer.formToken)}
<label>Name <input name="name" required maxlength="100"></label><button type="submit">Create</button></form>
<h2>Upload a project</h2>
<form class="stack" method="post" action="/projects/upload" enctype="multipart/form-data">${hidden(viewer.formToken)}
<label>Name <input name="name" required maxlength="100"></label>
<label>Zip archive <input type="file" name="archive" accept=".zip,application/zip" required></label>
<button type="submit">Upload as a new project</button></form>`,
    viewer,
  )
}

export function accountPage(viewer: Viewer, error?: string, note?: string): string {
  return layout(
    "Account",
    `<h1>Account</h1><p>Signed in as ${esc(viewer.email)}.</p>${message(error, note)}
<h2>Change password</h2>
<form class="stack" method="post" action="/account/password">${hidden(viewer.formToken)}
<label>Current password <input type="password" name="current" autocomplete="current-password" required maxlength="1024"></label>
<label>New password (at least 10 characters) <input type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="1024"></label>
<button type="submit">Change password</button></form>
<p>Changing the password signs you out everywhere else.</p>
<h2>End all sessions</h2>
<p>Signs you out everywhere and forgets every device you signed in from.</p>
<form method="post" action="/account/end-sessions">${hidden(viewer.formToken)}<button class="quiet" type="submit">End all sessions</button></form>
<h2>Sign out on a shared computer</h2>
<form method="post" action="/signout">${hidden(viewer.formToken)}<input type="hidden" name="forget" value="1"><button class="quiet" type="submit">Sign out and forget this device</button></form>
<h2>Delete my account</h2>
<p>This deletes your account and every project, with all its files, at once. It cannot be undone.</p>
<form class="stack" method="post" action="/account/delete">${hidden(viewer.formToken)}
<label>Type your email to confirm <input type="email" name="confirm" required maxlength="254" autocomplete="off"></label>
<label>Password <input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label>
<button type="submit">Delete my account and all my data</button></form>`,
    viewer,
  )
}

export function textPage(title: string, text: string, viewer?: Viewer): string {
  return layout(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`, viewer)
}

export function privacyPage(viewer?: Viewer): string {
  return textPage("Privacy", "The maintainer of this service supplies this text before the service opens. Until then, nothing here is a promise.", viewer)
}

export function termsPage(viewer?: Viewer): string {
  return textPage("Terms", "The maintainer of this service supplies this text before the service opens. Until then, nothing here is a promise.", viewer)
}
