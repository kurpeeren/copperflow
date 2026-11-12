# Running copperflow behind the hub

A workspace runs the unchanged Studio (`startStudio({ hosted })`) and MCP server (`copperflow mcp --http`) against
one project folder. It trusts one thing: the workspace ticket the hub adds to each request it proxies.

## The workspace ticket

- Header `x-copperflow-ticket`: `base64url(payload).base64url(signature)`, payload `{ w, u, iat, exp }` (workspace
  id, user id, issued at and expiry in seconds since the epoch), signed with Ed25519 (`signTicket` in
  `src/hosted/ticket.ts`).
- The hub holds the private key. A workspace gets only the public key, in `COPPERFLOW_TICKET_PUBLIC_KEY` (base64
  of the raw 32 bytes, or PEM); a private key there is refused. Nothing in a workspace can make a ticket.
- A workspace refuses a ticket for another workspace, an expired one, one issued more than 30 s in the future,
  and one that lives longer than 15 minutes. Sign tickets for a minute or two and sign a new one per request.
- Event streams (the Studio's and MCP's GET stream) end when their ticket expires, and after 15 minutes at most;
  the client reconnects through the hub, which signs a fresh ticket.
- An MCP session belongs to the user whose ticket opened it; a ticket for another user cannot drive it.

## What the hub must do

1. **Strip incoming headers, forward the public Host.** Remove any `x-copperflow-ticket` and `x-forwarded-host`
   the browser or agent sent, then set the ticket it signed. Forward `Host` as the public host (for example
   `copperflow.example.com`): the MCP server checks `Host` and nothing else, as does the SDK's allowed-hosts check
   behind it, and the Studio accepts it too. A workspace cannot tell a header the hub set from one it passed
   through.
2. **Authenticate first.** Sign a ticket only for a request whose session cookie or access token names a user who
   may open that workspace.
3. **Cookies.** Session cookies are `HttpOnly`, `Secure` and `SameSite=Lax` (or `Strict`).
4. **Never proxy a cross-site request with a ticket.** Refuse, before signing, any request whose `Origin` (or,
   without one, `Sec-Fetch-Site: cross-site`) is not the public origin. The workspace refuses a foreign `Origin`
   too; the hub's check keeps a ticket from ever being made for one.
5. **Reach workspaces only on their private interface.** Their ports are never public. `copperflow mcp --http`
   refuses to start without a ticket key, and without one may listen only on a loopback address.
6. **Pass the base path.** The Studio of a project is served under its base path (such as `/p/<project>`); the hub
   forwards the path unchanged and the workspace refuses anything outside it.
7. **Start a workspace with no secrets in its environment.** Give it only `COPPERFLOW_TICKET_PUBLIC_KEY`, the
   workspace id and the public origin: no private key, database address, token or password. The workspace process
   is the last line before the container, so nothing in it may be worth stealing.

## Running the hub

The hub (`src/hub/`) owns accounts, sessions, projects and the public endpoint. It listens on loopback behind a TLS
reverse proxy.

```
copperflow hub --data <dir> --port <n> --public-origin https://copperflow.example.com \
  --workspace-domain ws.copperflow.example.com --trusted-accounts-only [--bind 127.0.0.1] [--trust-proxy]
copperflow hub invite --data <dir> [--count n]        invite codes, printed once (only their hashes are kept)
copperflow hub reset-password <email> --data <dir>    a one-time password, printed once; ends the user's sessions
copperflow hub status --data <dir>                    users, projects, running workspaces, disk used
copperflow hub delete-user <email> --data <dir>       asks for the email typed; deletes the user and their files
```

**The process runner and `--trusted-accounts-only`.** Until Task 3's container runner exists, workspaces run as plain
child processes of the hub's user. That is not a security boundary: circuit code that escapes the engine's guard can
read every other account's projects, the database and the ticket key. The hub therefore refuses to start without
`--trusted-accounts-only`, and with it (and on every `hub invite`) prints that every account can read every other
account's data and the hub's keys.

**Workspaces on their own origins.** Project `<id>` is served on `https://<id>.<workspace domain>/`, never on the
public origin, so content a project serves (or a Studio flaw triggered by project data) cannot read or drive the hub's
pages. `/p/<id>/` on the public origin hands a signed-in owner over: a one-time token (random, single use, 30 s, bound
to the user, the project and the hub session) in a redirect to `https://<id>.<workspace domain>/_enter?t=…`, which sets
a workspace cookie (`__Host-`, HttpOnly, SameSite=Lax) and redirects to `/`. The workspace session lasts 12 hours at
most, never beyond the hub session it came from, and ends with it. Every request on a project origin is authenticated
by that cookie only, checked against the project in the Host and the user's revocation epoch (bumped by sign-out,
password change or reset and deletion), and the ticket is signed last, just before the upstream request. Proxied
answers carry only `content-type`, `content-length`, `content-encoding`, `cache-control`, `etag`, `last-modified`,
`content-disposition` and `vary`, plus `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors
<public origin>` and a `Location` only when it is a path on the same project origin. A reverse proxy that issues
certificates on demand asks `GET /_tls-ask?domain=<host>`: 200 only for the public host and for
`<existing project id>.<workspace domain>`, 404 otherwise. It is answered only to a connection from loopback (the
proxy on the same machine), on any Host, and is not rate limited (one indexed lookup; a limit would be shared by every
handshake). Point the proxy's ask URL at the hub's own port, for example Caddy's
`on_demand_tls { ask http://127.0.0.1:<hub port>/_tls-ask }`. The maintainer provides a
wildcard DNS record for the workspace domain and either a wildcard certificate or on-demand certificates.

**A separate domain for workspaces is recommended; with a subdomain of the same site the closed beta carries this
limited risk:** a hostile project page can set cookies for the whole site and fill the browser with them, so the hub
becomes unusable in that browser until the cookies are cleared (the hub accepts headers up to 64 KB and answers a
larger block with a page that says to clear the site's cookies). It cannot read or forge a session: the public origin
must be https (plain http only on 127.0.0.1, ::1, localhost or `*.localhost`), so the hub's cookies always carry the
`__Host-` prefix and cannot be set from a subdomain. The hub prints a warning at start when the two share their last
two labels. A project origin never serves a worker script (any request with a `Service-Worker` header gets 404), and
`/_enter` answers with `Clear-Site-Data: "storage"` and `Referrer-Policy: no-referrer`. Without an Origin header, a
request to a project's `/api/` needs `Sec-Fetch-Site: same-origin` or `none`, so a sibling project (same site) gets no
ticket; a browser too old to send Sec-Fetch headers is let through on such GETs (it sends an Origin on every POST).

`--trust-proxy` reads the client's address from the last `X-Forwarded-For` entry; use it only behind a proxy that
sets that header, or every limit counts the proxy's address. With it, the hub's own cap of 64 open connections per
address is off (every connection comes from the proxy), so the reverse proxy must cap connections per client.

Timeouts: headers within 10 s; an idle socket closes after 60 s; an ordinary request's body within 60 s (forms
15 s); an upload is stopped after 30 s without a byte or below 32 kB/s on average after 30 s, and Node's request
timeout (2 hours, the longest a 200 MB upload may take at that rate) is the backstop. An answer given before a body
was read closes the connection. At most 4 uploads run in the hub, one per user (a second gets 429 at once); at most 2
downloads per user. Uploads stream to `<data>/uploads/` with the size cap enforced as they arrive, and downloads
stream file by file. A user runs at most 3 workspaces (opening a 4th stops their least recently used one); when the
server's 20 are taken, a user above their fair share gives way, else 503. An open stream keeps a workspace alive for
12 hours at most.

Revocation: sign-out, a password change, "End all sessions" and account deletion end the user's sessions and
workspace sessions, cut their open proxied streams and stop their workspaces at once. The maintainer's
`reset-password` and `delete-user` run in another process: they record the request in the database and the running
hub carries it out at its next sweep, within 15 seconds. A deleted project or user is marked deleted first, so every
route and the proxy answer 404 while its workspace stops and its files go.

A workspace is started on demand as `copperflow workspace --root <folder> --id <project id> --public-origin
https://<id>.<workspace domain> --base-path / --studio-port 0 --mcp-port 0`, with only `COPPERFLOW_TICKET_PUBLIC_KEY`
in its environment; it prints `{"studio": "...", "mcp": "..."}` when both servers listen and stops on SIGTERM or when
its standard input closes.

The data directory (created owner-only; an existing directory, `hub.db` or key file that group or others may read is
refused with a message; on Windows these modes are not checked, since access lists decide there, so keep the data
directory in a folder only the hub's account can open):

- `hub.db`: SQLite (`node:sqlite`; the hub needs Node 22.13 or later and says so, the rest of copperflow runs on 22):
  users (email NFC and lower-cased, scrypt hash with its salt and parameters), invite codes, session ids, workspace
  session ids and device ids as SHA-256 hashes, projects (id, owner, name), the audit log.
- `ticket-key.pem`: the ticket private key, made on first start with mode 600. Never logged, never sent; workspaces
  get the public half.
- `projects/<user id>/<project id>/`: the project folders. Both ids are generated; a project's name is only a label.
- `uploads/`: uploads in progress, removed when each ends.
- `hub-status.json`: written every 15 s for `hub status`.

A session ends 14 days after its last use and 30 days after sign-in whatever its use. A password set by
`reset-password` must be changed at the next sign-in before anything else.

The audit log (`audit` table: time, user id or none, event, address, detail) records `signup`, `signup-failed`,
`signup-limited`, `signin`, `signin-failed`, `signin-limited-address`, `signin-limited-email`,
`signin-limited-strict`, `signin-strict`, `signin-strict-table-full`, `signout`, `signout-forget-device`,
`sessions-ended`, `password-changed`, `password-change-failed`, `password-change-limited`, `account-delete-failed`,
`account-delete-limited`, `account-deleted`, `password-reset`, `invites-made`, `project-created`, `project-renamed`,
`project-deleted`, `project-downloaded`, `project-uploaded`, `upload-refused`, `workspace-entered`,
`hub-unhandled-rejection` and `hub-uncaught-exception` (the error's name and code only; after an uncaught exception
the hub closes cleanly for its service manager to restart it, after an unhandled rejection it keeps serving). The detail holds a project id, a file
count or the reason an upload was refused, never a password, cookie, invite code or ticket.

Agent events: `token-created`, `token-revoked`, `token-refused` (a bearer token /mcp refused, at most 10 per 15
minutes per address; a code or refresh token the token endpoint refused), `token-refreshed`, `client-registered`,
`client-register-limited`, `consent-allowed`, `consent-denied`, `grant-created`, `grant-revoked`,
`refresh-reused-grant-revoked`, `agent-connected` and `tool-calls-limited`. The detail holds an id (token, grant or
client) or the grant type, never a token or code.

## Connecting an agent

An agent connects to `https://<public origin>/mcp` (Streamable HTTP). That endpoint is served only on the public
origin (404 on a project origin) and authenticated only by `Authorization: Bearer <token>`; a cookie never counts. A
request without a valid token gets 401 with `WWW-Authenticate: Bearer resource_metadata="<public
origin>/.well-known/oauth-protected-resource"`.

**Tokens.** All are a prefix and 32 random bytes, stored only as SHA-256 hashes, never logged or put in a URL or an
error. Personal access tokens (`cfp_`) are made on the account page, shown once, listed by name, creation and last
use, revocable; at most 10 per user. OAuth access tokens (`cfa_`) last one hour; refresh tokens (`cfr_`) 30 days and
rotate on every use: a refresh token used twice revokes its whole grant and closes its sessions.

**OAuth 2.1** (the MCP specification's flow, written on `node:http` with the SDK's schemas and types; the SDK's
express-based helpers are not used):
`/.well-known/oauth-protected-resource` (also `/mcp` appended) and `/.well-known/oauth-authorization-server`;
`POST /oauth/register` (public clients only, `token_endpoint_auth_method: none`; 1 to 5 redirect URIs, each https,
or http on 127.0.0.1, [::1] or localhost, without user, password or fragment, at most 2000 characters; names 1 to 100
characters; 20 registrations an hour per address; at most 10 000 clients, a full table making room only by dropping
a never-used client over an hour old; clients unused for 30 days expire); `GET /oauth/authorize` (code with PKCE S256
required, `state` returned, `resource` if given must be the /mcp URL; the redirect URI must match a registered one
exactly, otherwise an error page and no redirect; signed out, the request is kept server-side for 10 minutes, named by
a cookie, and the person comes back to it after signing in; 30 requests per 15 minutes per address); a consent page
naming the client and the exact redirect host, with Allow and Deny as POSTs with the form token; `POST /oauth/token`
(codes single use for 60 s, bound to the client, redirect URI, challenge and the user's revocation epoch; a wrong
verifier uses the code up); `POST /oauth/revoke` (an access token alone, a refresh token with its grant). The token,
registration, revocation and metadata endpoints read no cookie and answer any origin (CORS `*`). The account page
lists connected clients (one per grant) with revoke.

**What the hub answers and forwards.** The hub is the MCP server the agent talks to. Its instructions are the hosted
server's plus two lines (open or create a project first; the person watches at `<public origin>/p/<id>/`). It answers
`list_projects`, `new_project { name }` (the project quotas apply; it opens the project) and `open_project { name |
id }` (another user's project reads exactly as a missing one), and `guide` from the skill files. Every other tool is
advertised from the hosted tool list, read once at start by an in-memory MCP client from a hosted server made for a
folder that does not exist (listing tools only serialises schemas: no circuit code runs), and forwarded to the open
project's workspace: the hub ensures the workspace and calls the tool on the workspace's MCP server as an MCP client,
with `Host` set to the project origin's host and a one-minute ticket signed just before each request, only while the
session, its token, the user's revocation epoch and the project still hold. The answer passes through unchanged. With
no project open, a forwarded tool answers an error naming the three project tools. Measured 2026-11-12: instructions
and `tools/list` 42 725 characters (limit 43 000), `guide` 15 390 (limit 16 000).

**Limits.** 60 tool calls per minute per user (answered inside the tool result as an error with the wait); at most 4
MCP sessions per user at the hub (mcp-sessions.ts's rule: at the limit the user's longest-idle session without a
stream closes, else 429), 512 in all, 30 idle minutes, 12 hours at most; a GET stream ends at its access token's
expiry or after 15 minutes; request bodies 4 MB.

**Revocation.** A password change (also the forced one after a reset), "End all sessions", account deletion and the
maintainer's `reset-password` and `delete-user` all call one function (`src/hub/revocation.ts`): it ends the hub and
workspace sessions, forgets the devices, revokes every grant with its access and refresh tokens and every personal
access token, drops pending OAuth requests and codes, closes the open agent sessions (cutting their streams), bumps
the revocation epoch and stops the workspaces. The maintainer's commands do the database part themselves and the
running hub the rest at its next sweep. A plain sign-out touches no agent credential. Every /mcp request checks its
token again, so a revoked or expired token ends the agent's access at its next request.

### Sign-in limits

Every password check is counted before it starts, as if it failed, and refunded when the password is right: concurrent
attempts cannot pass a check together, and a correct password costs nothing. Windows are 15 minutes.

| What is counted | Per | Limit | At the limit | Exempt |
| --- | --- | --- | --- | --- |
| Failed sign-ins | Address (IPv4 whole, IPv6 /64) | 10 | 429 with Retry-After | Nobody |
| Failed sign-ins | Email, existing or not (65 536 fixed buckets by a keyed hash made at start, never stored) | 20 | 429 with Retry-After, the same for every email | A request with that account's device cookie |
| Failed sign-ins | Everyone (strict mode) | 300, or a full limiter table | Attempts pass a token bucket of 5 per second; at most 2 wait per address, served in turn across addresses, 50 in all; beyond that 429 | A request with that account's device cookie |
| Failed current-password checks (change password, delete account) | User id | 10 | 429 with Retry-After | Nobody; the sign-in route cannot reach this counter |
| Sign-ups | Address | 20 per hour | 429 | Nobody |

A device cookie is set at each successful sign-in (random, stored hashed, at most 10 per user, one year). A normal
sign-out keeps it, so a person who signed out is not locked out by strangers; that costs nothing, since the per-address
limit still applies to that browser and the exemption gives it no more guesses than any address has. "Sign out and
forget this device" drops this browser's record; a password change or reset, account deletion and "End all sessions"
delete all the user's devices. A limiter table holds 100 000 keys and never forgets a key with failures in its window; a new key that
does not fit is not counted and turns strict mode on for the window. The audit log says `signin-strict` or
`signin-strict-table-full` once per window.

What this does not stop:

- A flood from very many addresses can make sign-in from a new device slow, or refused, while it lasts. Known devices
  are unaffected.
- Once strict mode is on, a slow guess spread over many addresses still gets the gate's rate (5 per second for all).
  Below the strict threshold the limits allow 10 guesses per address per 15 minutes. Passwords therefore need at
  least 10 characters, and the audit log shows the failures.

Other limits: request bodies 1 MB except upload; 20 projects and 200 MB per user, checked under a per-user lock.
Sessions last 14 days, renewed on use; sign-out and a password change end every session of the user.
A download is every regular file of the project except leftovers of interrupted writes (`*.<pid>.<hex>.tmp`);
`.copperflow/history/` is kept, since it is the undo history and not a cache.

## Inside a workspace

- Circuit code is built only in the engine's worker thread, never in the server's main thread: the Studio's and
  the agent's builds, and the build that fits the board after Autoplace. Behind the hub, Autoroute and Autoplace
  are refused when no worker thread can be started, instead of running in the server process.
- Those workers start with an empty environment. That shrinks what code escaping its `node:vm` context can read
  at once; it is not a boundary, since such code runs in the workspace process. The boundary is the container, and
  rule 7 above keeps that process's environment free of secrets.
- Session limits: a user holds at most 4 MCP sessions (at the limit their own longest-idle session is closed, or
  the request gets 429 when every one holds an open stream). The server holds at most 16: when full, the
  longest-idle session of a user holding more than their fair share (16 divided by the users with sessions) is
  closed, else 429. Slots are reserved before a session finishes initialising, so concurrent initialises cannot
  pass the limits together. A session with an open stream counts as active; others close after 10 idle minutes,
  and every session closes 60 minutes after it opened.
- In round 1 a workspace serves one user, so the per-user limit is the one that applies; the server-wide cap and
  fair share matter once workspaces are shared.
- The importer (`import_part`) is not offered; `create_part` refuses a part with more than three pins without a
  datasheet link unless its description says "Pins NOT from a datasheet".
