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

1. **Strip incoming headers.** Remove any `x-copperflow-ticket` and `x-forwarded-host` the browser or agent sent,
   then set them itself: the ticket it signed, and the public host. A workspace cannot tell a header the hub set
   from one it passed through.
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

## Inside a workspace

- Build, route and place workers start with an empty environment, so circuit code that escaped its `node:vm`
  context finds no key, token or path in `process.env`.
- The importer (`import_part`) is not offered; `create_part` refuses a part with more than three pins without a
  datasheet link unless its description says "Pins NOT from a datasheet".
