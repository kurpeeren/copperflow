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
8. **The hub never reads a project's file contents while its workspace runs.** A download or deletion first blocks
   the project in the runner: every launch path (the first start, the retry after another workspace was stopped to
   make room, the crash restart) refuses it, the workspace is stopped, and the engine must confirm its container is
   gone, or nothing is read and the person is told to try again. Requests meanwhile get a short "being downloaded or
   deleted" answer and the Studio reconnects afterwards. With the container gone nothing can swap a folder for a link.
   While workspaces run the hub only measures their folders with `lstat`, checking each folder's real path, device
   and inode before and after reading it, and never opens a file.
9. **Nothing writes into or removes from a folder a container can mount.** An upload is unpacked into a staging
   folder under `<data>/uploads/` that is no project, and moved into place with one `rename` only when it is whole.
   Every removal under `<data>/projects` goes through one function (`src/hub/project-folders.ts`): it blocks each
   project as above and renames its folder into `<data>/trash/`, out of every mount. Code in a workspace owns what it
   creates and may make it owner-only, which the hub (another uid) could then neither measure nor remove, so with the
   container runner the trash folder is emptied by a short-lived cleaning container: the workspace user, ONLY that
   trash folder mounted, `--network none`, `--log-driver none`, a read-only root, `--cap-drop ALL`,
   `no-new-privileges`, 32 pids, 128 MB, half a CPU, a 2-minute limit, and the fixed command `copperflow
   workspace-clean /work` built into the image (it makes every entry owner-writable without following links, then
   removes everything). Removal uses both hands: first the hub gives what it owns in the trash folder the workspace
   group, then the cleaning container removes what it can (the workspace's own entries), then the hub removes what it
   owns itself, then the empty folder; either alone is not expected to finish. Until a trash folder is really gone it
   counts in its user's usage; a removal that fails is written to the audit log as a fixed category (`timeout`,
   `engine-error`, `permission`, `not-empty`, `unknown`) and retried after 5 seconds, doubling up to 10 minutes, and
   `hub status` lists trash that failed more than three times. With the process runner (one uid) the hub removes the
   trash folder itself. A deletion blocks the project first; if the block is refused (a download is running, or the
   engine cannot confirm the stop) the answer is a 503 and nothing changes, and only then is the project marked
   deleted. A deletion that did not finish, a staging folder older than an hour and a project folder with no row (a
   crash between the upload's rename and its row) are finished by the hub's sweep and at its start, and audited. A test
   fails if any line in `src/hub` but the removal module calls `rm`, `rmdir`, `unlink`, `rename` or the project's own
   remove helpers without saying on that line that it never removes from the projects tree.
10. **Nothing a person or a container controls reaches the maintainer unsanitised.** A project or client name, an
   email, an engine's or a container's error output and a file name go through one `printable` helper (control
   characters, C1 controls, bidirectional overrides and line breaks replaced, length capped) before the hub's commands
   print them and before they enter the audit log or `hub-status.json`.

## Running the hub

The hub (`src/hub/`) owns accounts, sessions, projects and the public endpoint. It listens on loopback behind a TLS
reverse proxy.

```
copperflow hub --data <dir> --port <n> --public-origin https://copperflow.example.com \
  --workspace-domain ws.copperflow.example.com --runner container --workspace-image copperflow-workspace \
  --workspace-group <gid> [--container-command docker] \
  [--workspace-reach loopback | --workspace-reach network --hub-container <name>] \
  [--bind 127.0.0.1] [--trust-proxy <proxy address or CIDR>] [--hsts-include-subdomains]
copperflow hub ... --runner container --workspace-user-same-as-hub      a trial on your own machine only (see below)
copperflow hub ... --runner process --trusted-accounts-only      tests and accounts you trust only (see below)
copperflow hub invite --data <dir> [--count n]        invite codes, printed once (only their hashes are kept); warns
                                                      when the hub last started with the process runner
copperflow hub stop-workspace <project id> --data <dir>   the running hub stops that workspace within 15 s (not a
                                                      crash: no restart; the next request starts it again)
copperflow hub check-data --data <dir> [--workspace-group <gid>] [--fix]   owners, groups, modes and links the hub
                                                      relies on; exit 1 on a problem; --fix only with the hub stopped
copperflow hub reset-password <email> --data <dir>    a one-time password, printed once; ends the user's sessions
copperflow hub status --data <dir>                    users, projects, the runner, running workspaces (and each
                                                      container's memory), disk used; --json: one JSON line
copperflow hub backup --data <dir> --to <file>        a consistent copy of hub.db taken while the hub runs; prints
                                                      its counts as JSON (deploy/backup.sh archives the rest)
copperflow hub delete-user <email> --data <dir>       asks for the email typed; marks the user deleted, and the
                                                      running hub removes their workspaces and files within 15 s
copperflow hub --help | -h | help                     every command with each one's options; `hub <command> --help`
                                                      (or `hub help <command>`) shows one; exit 0, nothing is read
```

The usage in `--help` and in every refusal is made from one option table (`src/hub/hub-usage.ts`), which is also the
parser's list of options without a value and the server's list of known options; text goes through the same `printable`
filter as all hub output. An unknown command or option is still refused.

`--trust-proxy` names the TLS proxy's address or CIDR (comma-separated for several): `X-Forwarded-For` is honoured
only on connections from there, and taken as the client's address; from anyone else it is ignored.

With an https public origin every answer, the hub's pages and proxied project answers alike, carries
`Strict-Transport-Security: max-age=31536000`; `--hsts-include-subdomains` adds `includeSubDomains` for a maintainer
whose whole domain is https. The reverse proxy adds no security header of its own.

**The container runner (`--runner container`).** This is the security boundary between accounts: each workspace runs
in a container of its own (`src/hub/runner/container-runner.ts`), started with an argument array (never a shell) from
values the hub generated or checked. Every container is started as:

- `--rm --name cf-ws-<project id>` (the id must be the 32 lower-case hex characters the store generates), `--user
  10001:<workspace group>`, `--log-driver none`, `--read-only`, `--tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m`,
  `--cap-drop ALL`, `--security-opt no-new-privileges`, `--pids-limit 128`, `--memory 768m --memory-swap 768m` (no
  swap), `--cpus 1`, `--ulimit nofile=1024:1024`; never `--privileged`, never a host namespace, never the Docker socket.
  With `--log-driver none` nothing the container prints reaches the engine's own log files (which live on the system
  disk, outside every quota): the hub reads the ready line and at most 64 KiB of the log from the attached streams;
- one bind mount, the project folder at `/work`, and nothing else from the host;
- one environment variable, `COPPERFLOW_TICKET_PUBLIC_KEY` (the hub's PUBLIC key; the workspace command needs nothing
  else: its id and origin are on its command line). The engine itself adds `PATH` and `HOSTNAME`, and the image its
  `NODE_VERSION`, `YARN_VERSION`, `NODE_ENV`, `HOME=/tmp` and `NPM_CONFIG_CACHE`; none is a secret;
- a network of its own, `cf-ws-<project id>`, created with `--internal` (no route out, no DNS beyond the network) just
  before the container and removed after it. Two workspaces never share a network. Inside, both servers bind to
  `0.0.0.0` on fixed ports 8080 (Studio) and 8081 (MCP); since the bind is not loopback the hub's ticket is required on
  every request, and the Host accepted is the project origin, as everywhere. The hub records each workspace network's
  subnet (from `docker network inspect`) and closes any connection to its own listener from inside one before a byte
  of it is read; a subnet is forgotten only when the engine confirms that network instance gone (a removal it cannot
  confirm keeps the subnet refused and is retried every 5 seconds).

**Users and groups.** Workspaces run as uid 10001, a user that is never the hub's, and share one group with the hub:
`--workspace-group <gid>`. The hub refuses the container runner when it runs as root, as uid 10001, or outside that
group. Each project folder is owned by the hub, in that group, with mode 2770 (setgid, so what the container creates
keeps the group), and the workspace sets its umask to 007, so the hub can read, measure and remove what the container
writes. Everything the hub itself writes into a project (an uploaded archive, unpacked while still in staging where no
container sees it; a new empty project) gets the group too: folders 2770, files 0660. Everything else in the data
directory (the database, the ticket key, the other users' folders above the project folder) stays 0600/0700 with no
group access, so uid 10001 can read none of it even after a container escape. When a workspace starts, only the project
folder itself is given the group and mode again, not its contents. Nothing was deployed before this scheme, so a
project folder made by an earlier version (with 0600/0700 contents) must be removed or re-uploaded. To set this up on
the server:

```
groupadd --system copperflow-ws                         # the group the hub shares with its workspaces
useradd --system --create-home --shell /usr/sbin/nologin copperflow-hub
usermod -aG copperflow-ws,docker copperflow-hub         # docker: may run containers (root-equivalent on this machine)
getent group copperflow-ws                              # its gid is the --workspace-group value
```

Never make the data directory group- or world-writable to "fix" a permission error: `chmod 777` (or 775) would give
every workspace, and every other local user, the hub's key and every account's files. `--workspace-user-same-as-hub`
runs workspaces as the hub's own user instead, for a trial on your own machine; the hub then says at start that a
container escape would run as the hub's user. The hub also says at start whether the engine runs rootless or with
user-namespace remapping (from `docker info`); either is fine and changes nothing in what the hub does.

How the hub reaches a workspace is `--workspace-reach`: `loopback` (the default; the hub runs on the host) publishes the
two ports on `127.0.0.1` only, on ports the engine picks, read back with `docker port`; `network` (the hub runs in a
container named by `--hub-container`) connects the hub's container to the workspace's network for the workspace's life
(`docker network connect`, then `disconnect` and `network rm` when it stops) and reaches it by its container name. The
Compose file of Task 4 runs the hub in a container and uses `--workspace-reach network`.

The runner reads the container's first line (the same JSON address line as the process runner) within 60 s, copies at
most 64 KiB of its standard error to the hub's log, stops it with `docker stop -t 5` then `docker rm -f`, and restarts a
crashed one once (unless the project is blocked or its user is over quota). A workspace that keeps failing is not
restarted on every request: per workspace, after a start that fails or a workspace that exits within 60 seconds of
starting, the next start waits 2 s, then 4 s, 8 s, doubling to at most 5 minutes (a quick exit is not restarted at once
either); a workspace that has run for 10 minutes resets the wait. While waiting, requests for that workspace get 503
with `Retry-After` and nothing is launched. The state is per project, so one user's backoff never delays another's start. Before the hub listens it checks that
`docker version` answers with Docker Engine 26 or newer (Podman 5 or newer), since older engines forward DNS lookups
from internal networks to the host's resolvers; that the image exists (and warns when its base was not pinned by
digest); and that the engine can do what the chosen reach needs: create an internal network and either publish a port
on 127.0.0.1 from a container on it (loopback) or join the hub's container to it (network). It refuses to start with
the reason otherwise, then removes every `cf-ws-*` container and network (labelled `org.copperflow.workspace=1`) a
previous run left. The data directory must be an absolute path with no comma, quote or newline (it goes into a
`--mount` value). The limits are options of the runner with the defaults above; `--container-command podman` uses
Podman's identical command line.

**Memory inside a workspace.** The image starts the workspace with `node --max-old-space-size=160`, and in a hosted
workspace each build, route and place worker gets a 256 MB heap. Routing and placing are one run at a time per
workspace, the Studio's and the agent's together (a second answers "a routing or placement run is already in
progress"), and the Studio and the MCP server share the workspace's one engine, so agent builds queue on its one build
worker. At most the main thread (160 MB), a build (256 MB) and one route-or-place run (256 MB) are alive at once: 672 MB
inside the container's 768 MB. The hub's and the runner's log lines, the workspace's forwarded output included, go
through `printable` one line at a time, and forwarded output is marked `workspace <id> output |`. Unbounded allocation by circuit code ends as an out-of-memory build error before
the container's limit kills it.

Build the image from the repository (`deploy/workspace.Dockerfile`: a build stage runs `npm ci` and `npm run build`;
the final stage holds only `dist/`, `skills/`, `package.json` and the production `node_modules`, works for any uid,
and starts `node /app/dist/cli.js workspace` in `/work`; the base it was built from is in its `org.copperflow.base`
label):

```
docker pull node:22-bookworm-slim
docker image inspect --format '{{index .RepoDigests 0}}' node:22-bookworm-slim     # node@sha256:...
docker build -f deploy/workspace.Dockerfile --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:... -t copperflow-workspace .
```

Pin the base by that digest, and refresh it (the same three commands) when Node 22 has a security release.

### Before the first stranger's account

Run these on a machine with an engine, and see each one pass, before any stranger's account exists:

1. `docker version` shows server 26 or newer (or Podman 5 or newer).
2. Build with `--build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:...`. The hub prints no "not pinned by digest"
   warning.
3. `df <data dir>` shows a filesystem separate from `/` and from `/var/lib/docker`.
4. The hub runs as its own user (not root, not uid 10001), in the workspace group and the docker group. Starting as
   root, as 10001 or outside the group is refused.
5. As the hub's user, `npx vitest run test/hub-container-engine.test.ts` shows every test run and pass, with no skip
   line.
6. The hub starts with `--runner container` and prints the engine mode line. `hub status` shows the runner.
7. By hand: upload a zip with a subfolder, open it in the Studio, and the files load. Delete it, and `<data>/trash` is
   empty within 10 s.
8. Delete a project while its download is running, and it either deletes or stays listed.
9. `docker inspect` of a workspace shows LogConfig `none`. Flood stderr for a minute, and `/var/lib/docker` does not
   grow.
10. Kill the hub with `kill -9` while a workspace runs. The container ends, and the next start removes any `cf-ws-*` or
    `cf-clean-*` leftovers.
11. With `--workspace-reach network`, from inside a workspace, connecting to the hub's port is closed immediately, and
    no other workspace network is reachable through the hub container.
12. Run Studio build, autoroute and autoplace at once on the 200-part benchmark, and nothing is OOM-killed
    (`docker inspect` shows `OOMKilled=false`).
13. With the Compose arrangement, from inside a workspace container a connection to the proxy's address
    (`CF_HUB_EDGE_IP`, port 443) fails: `docker run --rm --network cf-ws-<project id> node:22-bookworm-slim node -e
    "require('net').connect({ port: 443, host: process.argv[1], timeout: 5000 }).on('connect', () => console.log('open')).on('timeout', () => console.log('timeout')).on('error', (e) => console.log(e.code))" <CF_HUB_EDGE_IP>`
    prints an error code (usually `ENETUNREACH`) or `timeout`, never `open`. The hub also closes, unread, a request
    that a trusted proxy forwarded for a client inside a workspace subnet (the same answer as for a workspace peer).

**The disk quota while workspaces run.** A workspace writes into `/work` freely, so every 5 seconds the hub measures the
project folders of each user with a running workspace, 4 users at a time and at most 2 s each (`lstat` only, never
opening a file; each folder read with `opendir`, its real path, device and inode checked before and after; at most
20 000 files and folders per user, which the projects page states), and, when the user is over the quota (200 MB or
20 000 entries) or cannot be measured (a failure, a cap reached, a folder that moved), stops all their running
workspaces at once and writes it to the audit log; one user's failure never stops the sweep for the others. The quota is
per user and asked by the runner itself immediately before every launch, from a measurement cached for 5 seconds and
shared by concurrent asks (a running workspace's requests never measure). None of an over-quota user's projects starts
— the Studio is not reachable and agents get the same message — until they are back under it; the projects page says
so, lists the projects largest first and keeps its download and delete actions. A download refuses a project of more
than 20 000 entries instead of holding them in memory, and lists anything it could not include (a link, a special
file, an entry the workspace made unreadable) in a `SKIPPED.txt` inside the zip. An entry or folder the hub cannot
read fails the measurement, which counts as over quota. What this does not stop: a workspace can write as fast as the
disk allows for up to about 5 seconds past its quota; and a workspace that swaps a folder for a link and back between
the two identity checks of one folder can add the sizes (never the contents) of host files under names it chose to its
own usage figure. For a hard cap, the maintainer may add filesystem project quotas
(XFS project quotas on the projects directory); copperflow does not set them up.

**The hub never follows a link in a project folder.** A project folder is writable from inside its container, so its
code can plant symbolic links, or swap a file for one between the hub's look and its read. Every hub-side read or
removal of a project folder (download, usage, the upload's unpack targets, deletion, `hub status`) goes through
`src/hub/safe-files.ts`: it walks with `lstat`, skips (and logs) links, devices, sockets and FIFOs, never descends
through a linked folder, opens files with `O_NOFOLLOW` and checks the open file is the one it listed (same device and
inode); a file swapped mid-download ends that download. Deletion unlinks links and never touches their targets. These
checks are defence in depth: the hub reads file contents only with the workspace stopped and confirmed gone, and
removes folders only after moving them out of every mount (rules 8 and 9 above), since `O_NOFOLLOW` guards only the
last part of a path and Node has no `openat`.

**The process runner and `--trusted-accounts-only`.** With `--runner process` (the default when `--runner` is not
given) workspaces run as plain child processes of the hub's user. That is not a security boundary: circuit code that
escapes the engine's guard can read every other account's projects, the database and the ticket key. The hub therefore
refuses to start with the process runner unless `--trusted-accounts-only` is given, and with it prints that every account can read every other account's data and the hub's keys. `hub invite` prints the
same warning when the hub last started with the process runner (read from `hub-status.json`), and says to start the
hub first when it has not run yet. With `--runner container` the flag is not needed and the warning is not printed.

**Time limits inside a workspace.** A build runs in a worker thread and is cut after 30 s by a timer on the workspace's
main thread (the worker is terminated and the build reported as a circuit-code error); circuit code cannot reach that
timer. Studio routing and placing run in workers too, cut at 10 minutes and at their 20 s budget plus a minute; the
router and placer run on design data, never circuit code. In a hosted workspace the agent's `autoroute` and
`autoplace` run in the same kind of worker, with their budget (at most 300 s) passed in and the worker ended at the
budget plus a minute, never on the main thread.

**Workspaces on their own origins.** Project `<id>` is served on `https://<id>.<workspace domain>/`, never on the
public origin, so content a project serves (or a Studio flaw triggered by project data) cannot read or drive the hub's
pages. `/p/<id>/` on the public origin hands a signed-in owner over: a one-time token (random, single use, 30 s, bound
to the user, the project and the hub session; a user holds at most 4 live ones and a fifth replaces their oldest, so
one user can never take more than 4 of the hub's 10 000 slots) in a redirect to `https://<id>.<workspace domain>/_enter?t=…`, which sets
a workspace cookie (`__Host-`, HttpOnly, SameSite=Lax) and redirects to `/`. The workspace session lasts 12 hours at
most, never beyond the hub session it came from, and ends with it. Every request on a project origin is authenticated
by that cookie only, checked against the project in the Host and the user's revocation epoch (bumped by sign-out,
password change or reset and deletion), and the ticket is signed last, just before the upstream request. Proxied
answers carry only `content-type`, `content-length`, `content-encoding`, `cache-control`, `etag`, `last-modified`,
`content-disposition` and `vary`, plus `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors
<public origin>` and a `Location` only when it is a path on the same project origin. A reverse proxy that issues
certificates on demand asks `GET /_tls-ask?domain=<host>`: 200 only for the public host and for
`<existing project id>.<workspace domain>`, 404 otherwise. It is answered only to a connection from loopback (the
proxy on the same machine) that carries no `X-Forwarded-For`, `Forwarded` or `Via` header (a request the proxy
forwarded is somebody else's, and gets 404; the proxy files in `deploy/` also answer the path with 404), on any Host, and is not rate limited (one indexed lookup; a limit would be shared by every
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
12 hours at most. Only `GET /api/events` (the Studio's event stream; the MCP stream is never proxied on a project
origin) may be a long-lived stream, and only when the answer is an event stream; every other answer, whatever its
content type, keeps the 64 MB and 60 s caps. A user holds at most 8 event streams at once; a ninth gets 429.

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
  session ids and device ids as SHA-256 hashes, projects (id, owner, name), the audit log. Its schema version is
  `PRAGMA user_version`: an older database is migrated in one transaction at open, a newer one is refused unchanged.
- `ticket-key.pem`: the ticket private key, made on first start with mode 600. Never logged, never sent; workspaces
  get the public half.
- `projects/<user id>/<project id>/`: the project folders. Both ids are generated; a project's name is only a label.
- `uploads/`: uploads in progress, removed when each ends.
- `hub-status.json`: written every 15 s for `hub status`.

A session ends 14 days after its last use and 30 days after sign-in whatever its use. A password set by
`reset-password` must be changed at the next sign-in before anything else.

Tables that a signed-in user's requests add rows to are bounded; the periodic sweep (every 15 s, the one that removes
expired sessions) enforces what a count cannot:

| Table | Rule |
| --- | --- |
| Workspace sessions | At most 8 live per user per project; a ninth ends that user's oldest for that project. Expired rows are deleted by the periodic sweep. |
| Sign-in sessions | At most 20 per user; a twenty-first ends that user's oldest. |
| Audit log, by age | Rows older than 180 days are deleted by the periodic sweep. This is the only rule that deletes a security event. The prune runs in batches of 2 000 rows (at most 25 a sweep, the event loop given back between them). |
| Audit log, by count | Events are of two classes. Routine: `workspace-entered`, refused tool calls (`tool-calls-limited`) and the suppression rows (`audit-suppressed`); the one list is `ROUTINE_AUDIT_KINDS` in `src/hub/audit-prune.ts`. Security: everything else, so a new kind is kept by default. Above 500 000 rows the sweep deletes the oldest routine rows only, in the same batches. Security rows are never deleted by count: if the table is still above the cap with no routine row left, nothing more is deleted, `hub status` (text and `--json`: `auditRows`, `auditOverCap`) reports it, and the hub logs one line a day. |
| Routine audit rows, per user | At most 20 rows per user per kind per 15 minutes; then one `audit-suppressed` row naming the kind for that window and no more of that kind until the window ends. |
| Security audit rows | Not suppressed; each kind is bounded by the limit on the action itself (sign-in limits, token and client caps, upload and project limits). |

The audit log therefore keeps 180 days. Every cap above is per user: a user's own requests cannot end another user's
sessions or use up their rows.

The audit log (`audit` table: time, user id or none, event, address, detail) records `signup`, `signup-failed`,
`signup-limited`, `signin`, `signin-failed`, `signin-limited-address`, `signin-limited-email`,
`signin-limited-strict`, `signin-limited-password`, `signin-strict`, `signin-strict-table-full`, `signout`, `signout-forget-device`,
`sessions-ended`, `password-changed`, `password-change-failed`, `password-change-limited`, `account-delete-failed`,
`account-delete-limited`, `account-deleted`, `password-reset`, `invites-made`, `workspace-stop-requested`, `project-created`, `project-renamed`,
`project-deleted`, `project-downloaded`, `project-uploaded`, `upload-refused`, `workspace-entered` (a routine kind),
`hub-unhandled-rejection` and `hub-uncaught-exception` (the error's name and code only; after an uncaught exception
the hub closes cleanly for its service manager to restart it, after an unhandled rejection it keeps serving). The detail holds a project id, a file
count or the reason an upload was refused, never a password, cookie, invite code or ticket.

Agent events: `token-created`, `token-revoked`, `token-refused` (a bearer token /mcp refused, at most 10 per 15
minutes per address; a code or refresh token the token endpoint refused), `token-refreshed`, `client-registered`,
`client-register-limited`, `consent-allowed`, `consent-denied`, `grant-created`, `grant-revoked`,
`refresh-reused-grant-revoked`, `code-reused-grant-revoked`, `grant-revoked-over-cap`, `token-create-failed`,
`token-create-limited`, `agent-connected`, `tool-calls-limited` (a routine kind: at most 20 per user per 15 minutes) and
`audit-suppressed` (the detail names the routine kind that was cut off). The detail holds an id (token, grant or
client) or the grant type, never a token or code.

## Connecting an agent

An agent connects to `https://<public origin>/mcp` (Streamable HTTP). That endpoint is served only on the public
origin (404 on a project origin) and authenticated only by `Authorization: Bearer <token>`; a cookie never counts. A
request without a valid token gets 401 with `WWW-Authenticate: Bearer resource_metadata="<public
origin>/.well-known/oauth-protected-resource"`.

**Tokens.** All are a prefix and 32 random bytes, stored only as SHA-256 hashes, never logged or put in a URL or an
error. Personal access tokens (`cfp_`) are made on the account page after the current password is typed (the
re-authentication limiter applies, since such a token outlives the session), shown once, listed by name, creation and
last use (written at most once a minute), revocable; at most 10 per user. OAuth access tokens (`cfa_`) last one hour; refresh tokens (`cfr_`) 30 days and
rotate on every use: a refresh token used twice revokes its whole grant and closes its sessions.

**OAuth 2.1** (the MCP specification's flow, written on `node:http` with the SDK's schemas and types; the SDK's
express-based helpers are not used):
`/.well-known/oauth-protected-resource` (also `/mcp` appended) and `/.well-known/oauth-authorization-server`;
`POST /oauth/register` (public clients only, `token_endpoint_auth_method: none`; 1 to 5 redirect URIs, each https,
or http on 127.0.0.1, [::1] or localhost, without user, password or fragment, at most 2000 characters; names 1 to 100
characters without control, direction or invisible characters); `GET /oauth/authorize` (code with PKCE S256
required, `state` returned, `resource` if given must be the /mcp URL; the redirect URI must match a registered one
exactly, otherwise an error page and no redirect); a consent page showing first the exact host the answer goes to,
then the client's name, with Allow and Deny as POSTs with the form token; `POST /oauth/token` (codes single use for
60 s, bound to the client, redirect URI, challenge and the user's revocation epoch; a wrong verifier uses the code up;
a code exchanged a second time revokes the grant issued from it); `POST /oauth/revoke` (an access token alone, closing
the sessions it authenticated; a refresh token with its whole grant). The token, registration, revocation and metadata
endpoints read no cookie and answer any origin (CORS `*`). The account page lists connected clients (one per grant)
with revoke; a person holds at most 10, and an 11th revokes their least recently used one with its tokens and
sessions. A grant whose refresh tokens have all expired is swept.

**Registration under load.** The body's shape is checked first (what is not a registration counts against nothing).
Then: 20 an hour per address (/64; a full address table refuses nobody), and every registration passes one global
bucket of 2 a second with at most 2 waiting per address and 40 in all (429 with Retry-After beyond it). The client
table holds 50 000. Never evicted: a client with a grant, with a live code, or with a request bound to a signed-in
person (at most 5 per person; an anonymous request protects nothing). An unused client is protected for 10 minutes
after registration, then evictable oldest first; clients unused for 30 days expire. Protected clients are at most
1 200 (what the bucket admits in 10 minutes) + 35 per account (10 grants, 20 codes, 5 bound requests), so the table
never fills while it exceeds that: 50 000 covers 1 394 accounts. A person whose client was evicted mid-flow (only
possible after 10 minutes without reaching the consent page) sees "This sign-in link is not valid", or at consent
"This request has expired. Start again from your application."; the application registers again.

**Pending authorisation requests.** Signed out, the request is kept server-side for 10 minutes, named by a cookie,
and the person comes back to it after signing in. Each browser gets a random id in its own `__Host-` cookie and holds
at most 3 requests (a 4th drops its own oldest); once the consent page is shown to a signed-in person the request
moves to that person (at most 5), out of reach of anonymous traffic. An address holds at most 20 live requests;
beyond that new ones are refused, never another's evicted, and expired ones are swept at least once a second. Every
request passes a global bucket of 5 a second (2 waiting per address, 40 in all) after the per-address limit of 30 per
15 minutes.

**What the hub answers and forwards.** The hub is the MCP server the agent talks to. Its instructions are one text
(`hubInstructions`): the workspace's rules with a single start order in place of the workspace's own (open or create a
project, then `project_status`, then `guide` once), and the line saying the person watches at `<public origin>/p/<id>/`;
the workspace's "call `project_status` first" never reaches a hub client. It answers
`list_projects` (names, ids and the number of circuit files, one listing of the project folder's own names; it reads nothing
below it, so no link a workspace planted is followed), `new_project { name }` (the project quotas apply; it opens the project) and `open_project { name |
id }` (another user's project reads exactly as a missing one), and `guide` from the skill files (the same arguments a second time in one session answer one short line unless `again: true`; the memory belongs to that MCP session, holds at most 32 argument sets and is never shared). Every other tool is
advertised from the hosted tool list, read once at start by an in-memory MCP client from a hosted server made for a
folder that does not exist (listing tools only serialises schemas: no circuit code runs), and forwarded to the open
project's workspace: the hub ensures the workspace and calls the tool on the workspace's MCP server as an MCP client,
with `Host` set to the project origin's host and a one-minute ticket signed just before each request, only while the
session, its token, the user's revocation epoch and the project still hold. The answer passes through unchanged. With
no project open, a forwarded tool answers an error, in one line, naming the three project tools. Measured
2026-11-12: instructions and `tools/list` 43 487 characters (limit 43 600; the tools state the limits of their
arguments, which the compact list drops from the schemas), `guide` 15 637 (limit 16 000).

**Limits.** 600 requests to /mcp per minute per user (429, counted from the headers before the body is read); 60
tool calls per minute per user (answered inside the tool result as an error with the wait); a request with more than
one Authorization header gets 400; project names are unique per person regardless of case; at most 4
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

Each agent session holds one connection to the open project's workspace, shared by its concurrent calls; one call
cancelled, timed out or refused leaves it in place, and only a failure of the connection itself replaces it. A
connection that finishes connecting after a revocation is closed.

What this does not stop:

- Anyone who sees an authorisation code can spend it first (then the real client's exchange fails) or, after the real
  exchange, present it again within 10 minutes and so revoke the grant issued from it (RFC 9700, 4.2.4). Both cost
  only availability: codes travel only in the redirect to the registered URI, are never logged, and live 60 s.

### Sign-in limits

Every password check is counted before it starts, as if it failed, and refunded when the password is right: concurrent
attempts cannot pass a check together, and a correct password costs nothing against the failure limits. Windows are 15
minutes. At most 2 password hashes (scrypt, on any route: sign-in, sign-up, change password, delete account) run at
once in the hub; the rest wait in arrival order.

| What is counted | Per | Limit | At the limit | Exempt |
| --- | --- | --- | --- | --- |
| Failed sign-ins | Address (IPv4 whole, IPv6 /64) | 10 | 429 with Retry-After | Nobody |
| Failed sign-ins | Email, existing or not (65 536 fixed buckets by a keyed hash made at start, never stored) | 20 | 429 with Retry-After, the same for every email | A request with that account's device cookie |
| Failed sign-ins | Everyone (strict mode) | 300, or a full limiter table | Attempts pass a token bucket of 5 per second; at most 2 wait per address, served in turn across addresses, 50 in all; beyond that 429 | A request with that account's device cookie |
| Failed current-password checks (change password, delete account) | User id | 10 | 429 with Retry-After | Nobody; the sign-in route cannot reach this counter |
| Correct passwords (sign-in, and current-password checks) | User id | 30 per 15 minutes | 429 with Retry-After, checked before the hash | Nobody. Only someone who knows the password can raise this counter, so a stranger cannot lock anyone out with it. |
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
