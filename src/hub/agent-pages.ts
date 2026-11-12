// The agent's parts of the hub's pages: personal access tokens and connected clients on the account page, and the OAuth
// consent page. No script; every text that did not come from this file goes through `esc`.
import { esc, hidden, layout, message, type Viewer } from "./pages.js"
import type { GrantView, PersonalToken } from "./token-store.js"

function when(ms: number | null): string {
  return ms === null ? "never" : new Date(ms).toISOString().slice(0, 16).replace("T", " ")
}

/** The account page's agent section; `created` is a token just made, shown this once. */
export function agentSection(viewer: Viewer, publicOrigin: string, tokens: readonly PersonalToken[], grants: readonly GrantView[], created?: string): string {
  const shown = created
    ? `<p class="note">Your new token, shown only now: copy it into your agent's settings.<br><code>${esc(created)}</code></p>`
    : ""
  const tokenRows = tokens
    .map(
      (t) => `<tr><td>${esc(t.name)}</td><td>${when(t.created)}</td><td>${when(t.lastUsed)}</td><td><form method="post" action="/account/tokens/${esc(t.id)}/revoke">${hidden(viewer.formToken)}<button class="quiet" type="submit">Revoke</button></form></td></tr>`,
    )
    .join("\n")
  const grantRows = grants
    .map(
      (g) => `<tr><td>${esc(g.clientName)}</td><td>${when(g.created)}</td><td>${when(g.lastUsed)}</td><td><form method="post" action="/account/clients/${esc(g.id)}/revoke">${hidden(viewer.formToken)}<button class="quiet" type="submit">Revoke</button></form></td></tr>`,
    )
    .join("\n")
  const head = "<tr><th>Name</th><th>Created</th><th>Last used</th><th></th></tr>"
  return `
<h2>Connect an agent</h2>
<p>Add <code>${esc(publicOrigin)}/mcp</code> to your agent as an MCP server. An agent that signs in by itself opens this site for your approval; for one that cannot, make a personal access token and give it as <code>Authorization: Bearer &lt;token&gt;</code>.</p>
${shown}
<h2>Personal access tokens</h2>
${tokens.length ? `<table><thead>${head}</thead><tbody>${tokenRows}</tbody></table>` : "<p>No tokens.</p>"}
<form class="stack" method="post" action="/account/tokens">${hidden(viewer.formToken)}
<label>Token name <input name="name" required maxlength="100" autocomplete="off"></label><button type="submit">Make a token</button></form>
<h2>Connected clients</h2>
${grants.length ? `<table><thead>${head}</thead><tbody>${grantRows}</tbody></table>` : "<p>No connected clients.</p>"}`
}

/** The consent page: the client's name and the exact host the answer goes to, with Allow and Deny as POSTs. */
export function consentPage(viewer: Viewer, request: string, clientName: string, redirectHost: string, error?: string): string {
  const form = (decision: "allow" | "deny", label: string, quiet: boolean) =>
    `<form method="post" action="/oauth/consent">${hidden(viewer.formToken)}<input type="hidden" name="request" value="${esc(request)}"><input type="hidden" name="decision" value="${decision}"><button${quiet ? ' class="quiet"' : ""} type="submit">${label}</button></form>`
  return layout(
    "Allow access",
    `<h1>Allow access to your projects?</h1>${message(error)}
<p>The application <strong>${esc(clientName)}</strong> asks to work in your copperflow projects as you: list, create and open them and change their circuits.</p>
<p>After you answer, you go back to <strong>${esc(redirectHost)}</strong>. Allow only if you started this from that application.</p>
<p>You can revoke it at any time on the account page.</p>
${form("allow", "Allow", false)} ${form("deny", "Deny", true)}`,
    viewer,
  )
}
