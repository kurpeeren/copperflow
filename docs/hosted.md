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

## Inside a workspace

- Circuit code is built only in the engine's worker thread, never in the server's main thread: the Studio's and
  the agent's builds, and the build that fits the board after Autoplace. Behind the hub, Autoroute and Autoplace
  are refused when no worker thread can be started, instead of running in the server process.
- Those workers start with an empty environment. That shrinks what code escaping its `node:vm` context can read
  at once; it is not a boundary, since such code runs in the workspace process. The boundary is the container, and
  rule 7 above keeps that process's environment free of secrets.
- Session limits: a user holds at most 4 MCP sessions (at the limit their own longest-idle session is closed, or
  the request gets 429 when every one holds an open stream); the server holds at most 16 (beyond that, 429).
  A session with an open stream counts as active; others close after 10 idle minutes.
- The importer (`import_part`) is not offered; `create_part` refuses a part with more than three pins without a
  datasheet link unless its description says "Pins NOT from a datasheet".
