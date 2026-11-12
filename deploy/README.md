# Running hosted copperflow: the runbook

This is what the maintainer does, in order, on their own server. Every step has the command and what it should
print. Nothing in this folder has been run on that server: the files were written against the code
(`src/hub/commands.ts`, `src/hub/server.ts`, `deploy/workspace.Dockerfile`) and checked by `test/deploy-files.test.ts`,
but no engine, proxy, certificate or DNS record was involved. The first run is the test; read each step's expected
output and stop at the first difference.

How the hub works, its limits and its security rules are in `docs/hosted.md`; this file does not repeat them.

## The two arrangements

| | A: Compose (`compose.yaml`) | B: systemd (`copperflow-hub.service`) |
| --- | --- | --- |
| The hub runs | in a container (`hub.Dockerfile`) | on the host, as `copperflow-hub` |
| It reaches workspaces | `--workspace-reach network` (joins each workspace's network) | `--workspace-reach loopback` (ports on 127.0.0.1) |
| The proxy | Caddy, in the hub container's network namespace | Caddy or nginx on the host |
| The engine | through the host's socket, mounted into the hub container | through the host's socket, as a member of `docker` |

Both are root-equivalent on the host in the end, for the same reason: the hub drives the host's container engine,
and whoever can drive it can start a container that mounts `/`.

**What the Docker socket means (arrangement A).** `compose.yaml` mounts `/var/run/docker.sock` into the hub's
container and adds the socket's group to it. Anyone who controls the hub container's process can therefore run any
container on the host, with any mount: the hub container is root-equivalent on the host. The container's own
hardening (read-only root, no capabilities, no-new-privileges, a non-root user) does not change that. A remote code
execution in the hub is a host compromise.

**The hub's user in the docker group (arrangement B).** The same, without the container around it: membership of
`docker` is root-equivalent. The systemd unit's hardening limits what the hub process itself can read and write; it
cannot limit what it may ask the engine for. In both arrangements the boundary that protects accounts from each other
is the workspace container (docs/hosted.md, "The container runner"), and the boundary that protects the host is that
the hub itself is not compromised.

**Why the proxy runs in the hub's network namespace (A).** The hub listens on 127.0.0.1 only, and answers the
proxy's certificate question `/_tls-ask` only to a connection from loopback (`src/hub/server.ts`). A proxy in a
container of its own reaches the hub from another address, so it would get 404 and no certificate would ever be
issued. Running Caddy with `network_mode: service:hub` puts it on the hub's loopback, so nothing in the hub had to
change. Two consequences, both handled in these files:

- The hub container joins each workspace's network, so Caddy would be reachable from inside every workspace if it
  listened on all addresses. It listens only on the hub container's fixed address on its own small network
  (`CF_HUB_EDGE_IP`, Caddy's `default_bind`), where the published ports 80 and 443 arrive.
- Every request Caddy forwards arrives from loopback. The hub therefore refuses `/_tls-ask` (404) when the request
  carries `X-Forwarded-For`, `Forwarded` or `Via` (a forwarded request is somebody else's; the proxy's own ask is a
  direct request), and both proxy files also answer the path with 404 themselves. The same holds for a proxy on the
  host in arrangement B.

Pick A unless you already run a reverse proxy on the host that you want to keep; then pick B with that proxy.

## 1. Prerequisites

- A Linux server with Docker Engine 26 or newer:

  ```
  docker version --format '{{.Server.Version}}'
  ```

  prints `26.x` or newer. Older engines forward DNS lookups from internal networks to the host's resolvers; the hub
  refuses them.
- Arrangement B only: Node 22.13 or newer (`node --version` prints `v22.13.0` or later); the hub needs `node:sqlite`.
- A filesystem of its own for the data directory, mounted at the path you will put in `CF_DATA_DIR` (default
  `/var/lib/copperflow`): when the projects fill it, the system disk and the engine's disk are untouched.

  ```
  findmnt --target /var/lib/copperflow
  ```

  shows a SOURCE that is neither the one for `/` nor the one for `/var/lib/docker`.
- DNS records, made by you (nothing here registers anything):
  - `copperflow.kurpeeren.com`: A (and AAAA if the server has IPv6) to the server.
  - `*.<workspace domain>`: a wildcard A/AAAA record to the same server. Project `<id>` is served on
    `https://<id>.<workspace domain>/`.

  `dig +short copperflow.kurpeeren.com` and `dig +short anything.<workspace domain>` both print the server's address.

**Why a separate registrable domain for workspaces is recommended.** Every project origin serves content a project
controls. If the workspace domain is under the same registrable domain as the public host (for example
`ws.copperflow.kurpeeren.com`), a hostile project page can set cookies for the whole site and fill a browser with
them, so the hub becomes unusable in that browser until the cookies are cleared. It cannot read or forge a session
(the hub's cookies carry the `__Host-` prefix), so this is an availability risk only, and the hub prints a warning at
start. A domain of its own (such as `copperflow-ws.example` bought for the purpose) removes it.

## 2. The hub's user, the workspace group and the data directory

As root:

```
groupadd --system copperflow-ws
useradd --system --create-home --shell /usr/sbin/nologin copperflow-hub
usermod -aG copperflow-ws,docker copperflow-hub
getent group copperflow-ws          # copperflow-ws:x:<gid>:copperflow-hub   -> CF_WORKSPACE_GID
id copperflow-hub                   # uid=<uid>(copperflow-hub) gid=<gid>(copperflow-hub) groups=...,copperflow-ws,docker
install -d -m 700 -o copperflow-hub -g copperflow-hub /var/lib/copperflow
stat -c '%a %U %G' /var/lib/copperflow    # 700 copperflow-hub copperflow-hub
```

- **Not root.** The hub refuses the container runner as root. As root, a flaw in the hub would be the host at once,
  without even needing the engine.
- **Not uid 10001.** That is the user every workspace container runs as. A hub with that uid could be read and
  changed by any escaped workspace; the hub refuses it.
- **Never `chmod 777` (or 775) to fix a permission error.** The data directory holds the database and the ticket
  key (0600/0700); group or world access would give every workspace and every local user the hub's key and every
  account's files. The hub refuses a data directory, `hub.db` or key that others may read. Project folders are 2770
  in the workspace group by design (docs/hosted.md, "Users and groups"); nothing else needs a group.
- `docker` membership is needed in both arrangements: in B the hub drives the engine with it; in A the backup script
  (`docker exec`) and check 5 below use it.

## 3. The code

As root, at the commit or tag you deploy:

```
git clone https://github.com/kurpeeren/copperflow.git /opt/copperflow
git -C /opt/copperflow checkout <tag or commit>
git -C /opt/copperflow log -1 --format='%H %s'
```

Keep `/opt/copperflow` owned by root: the hub reads it and never writes there.

## 4. The images, with the bases pinned by digest

Read each base's digest on the server (they change when the base is rebuilt; refresh them for a Node security
release):

```
docker pull node:22-bookworm-slim
docker image inspect --format '{{index .RepoDigests 0}}' node:22-bookworm-slim     # node@sha256:<64 hex>
docker pull docker:27-cli
docker image inspect --format '{{index .RepoDigests 0}}' docker:27-cli             # docker@sha256:<64 hex>
docker pull caddy:2
docker image inspect --format '{{index .RepoDigests 0}}' caddy:2                   # caddy@sha256:<64 hex>
```

Build, from `/opt/copperflow`, with a new tag for every build (the tag is what a rollback goes back to):

```
cd /opt/copperflow
docker build -f deploy/workspace.Dockerfile --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> -t copperflow-workspace:1 .
docker build -f deploy/hub.Dockerfile --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> \
  --build-arg DOCKER_CLI_IMAGE=docker:27-cli@sha256:<digest> -t copperflow-hub:1 .        # arrangement A only
docker image inspect --format '{{index .Config.Labels "org.copperflow.base"}}' copperflow-workspace:1
```

The last command prints `node:22-bookworm-slim@sha256:...`. Put `caddy:2@sha256:<digest>` in `CF_CADDY_IMAGE`.

**4b. Arrangement B only:** build the program on the host for the systemd unit:

```
cd /opt/copperflow && npm ci --no-audit --no-fund && npm run build
node /opt/copperflow/dist/cli.js hub status --data /tmp/cf-try && rm -rf /tmp/cf-try
```

The second line prints `Users: 0` and the other status lines.

## 5. The environment file

```
cp /opt/copperflow/deploy/hub.env.example /opt/copperflow/deploy/hub.env      # A
install -D -m 644 /opt/copperflow/deploy/hub.env.example /etc/copperflow/hub.env   # B
```

Fill in every empty value; each is explained in the file. The values to read on the server:

```
id -u copperflow-hub                         # CF_HUB_UID (A)
id -g copperflow-hub                         # CF_HUB_GID (A)
getent group copperflow-ws | cut -d: -f3     # CF_WORKSPACE_GID
stat -c %g /var/run/docker.sock              # CF_DOCKER_GID (A)
```

There is no secret in this file, and none may be added: the hub makes its ticket key in the data directory on first
start (`ticket-key.pem`, mode 600) and reads no environment variable of its own. If `CF_DATA_DIR` is not
`/var/lib/copperflow`, change `ReadWritePaths=` in the systemd unit to the same path (B).

Arrangement A, check what Compose will run:

```
docker compose --env-file deploy/hub.env -f deploy/compose.yaml config
```

It prints the whole file with every value filled in; an empty required value stops it with `set CF_... in hub.env`.

## 6. First start

### Arrangement A

```
cd /opt/copperflow
docker compose --env-file deploy/hub.env -f deploy/compose.yaml up -d
docker compose --env-file deploy/hub.env -f deploy/compose.yaml ps
docker compose --env-file deploy/hub.env -f deploy/compose.yaml logs hub
```

`ps` shows `hub` as `healthy` (after up to a minute) and `proxy` as running. The hub's log shows, in order: possibly
an engine warning, `Container engine mode: rootful, no user-namespace remapping.` (or rootless), the same-site warning
if the workspace domain shares the public host's site, and

```
copperflow hub is listening at http://127.0.0.1:8780 for https://copperflow.kurpeeren.com.
```

For the rest of this runbook, as root:

```
cfc() { docker compose --env-file /opt/copperflow/deploy/hub.env -f /opt/copperflow/deploy/compose.yaml "$@"; }
cf() { cfc exec hub node --no-warnings /app/dist/cli.js "$@"; }
```

**The per-client connection cap.** The hub's own cap (64 per address) is off for its trusted proxy, and Caddy has
none built in. Cap new connections per client address on the host, in Docker's own chain for published ports:

```
iptables -I DOCKER-USER -p tcp -m multiport --dports 80,443 -m connlimit --connlimit-above 64 --connlimit-mask 32 -j REJECT --reject-with tcp-reset
ip6tables -I DOCKER-USER -p tcp -m multiport --dports 80,443 -m connlimit --connlimit-above 64 --connlimit-mask 64 -j REJECT --reject-with tcp-reset
```

Make the rules permanent with the distribution's firewall tooling (they are lost at reboot otherwise).

### Arrangement B

```
install -m 644 /opt/copperflow/deploy/copperflow-hub.service /etc/systemd/system/copperflow-hub.service
systemctl daemon-reload
systemctl enable --now copperflow-hub
systemctl status copperflow-hub          # active (running)
journalctl -u copperflow-hub -n 20       # the same lines as in A, ending "copperflow hub is listening at ..."
curl -sS http://127.0.0.1:8780/healthz   # ok
```

Then the proxy on the host:

- **Caddy:** install `deploy/Caddyfile` as `/etc/caddy/Caddyfile` and give Caddy's service the same environment file
  (`systemctl edit caddy`, add `[Service]` and `EnvironmentFile=/etc/copperflow/hub.env`), then
  `systemctl restart caddy`. Cap connections per client with the same `connlimit` rules in the `INPUT` chain instead
  of `DOCKER-USER`.
- **nginx:** render `deploy/nginx.conf.example` as its header says, obtain the two certificates with the DNS
  challenge as it says, then `nginx -t` prints `syntax is ok` and `test is successful`. nginx caps connections
  itself (`limit_conn perclient 64`).

For the rest of this runbook, as root:

```
cf() { sudo -u copperflow-hub node --no-warnings /opt/copperflow/dist/cli.js "$@"; }
```

### Both: from outside the server

```
curl -sS https://copperflow.kurpeeren.com/healthz                                         # ok
curl -sS -o /dev/null -w '%{http_code}\n' 'https://copperflow.kurpeeren.com/_tls-ask?domain=x'   # 404
curl -sS -o /dev/null -w '%{http_code}\n' http://copperflow.kurpeeren.com/                 # 301 (nginx) or 308 (Caddy)
```

## 7. Invite codes

```
cf hub invite --data /var/lib/copperflow --count 3
```

prints `3 invite codes, shown only now (the hub keeps only their hashes):` and the three codes. Nothing follows when
the hub last started with the container runner (read from `<data>/hub-status.json`); after a start with the process
runner a warning follows that every account can read every other account's data; before the hub has ever started a
line says to start the hub first to know which runner is in use. Give each code to one person.

## 8. The first account

Open `https://copperflow.kurpeeren.com/signup`, enter an invite code, an email address and a password of at least 10
characters. The projects page opens. `cf hub status --data /var/lib/copperflow` now shows `Users: 1` and
`Unused invite codes: 2`.

## 9. Connecting an agent

- **URL:** `https://copperflow.kurpeeren.com/mcp` (Streamable HTTP).
- **OAuth (clients that support it):** add the URL in the client; it registers itself, opens the browser, you sign
  in and press Allow on the consent page, which shows the exact host the answer goes to. Redirect URIs must be https
  or http on loopback.
- **Token (other clients):** on the account page, make a personal access token (your password is asked again); it is
  shown once and starts with `cfp_`. The client sends `Authorization: Bearer cfp_...`.

The agent's first call should be `guide`; then `new_project { name }` and it draws. Watch at
`https://copperflow.kurpeeren.com/p/<project id>/`.

## 10. Before the first stranger's account

Run each and see it pass (docs/hosted.md, "Before the first stranger's account"). `<data>` is `CF_DATA_DIR`.

1. `docker version --format '{{.Server.Version}}'` prints 26 or newer.
2. The images were built with `NODE_IMAGE=node:22-bookworm-slim@sha256:...` (step 4), and the hub's log has no line
   containing `not pinned by digest`.
3. `findmnt --target <data>` shows a filesystem separate from `/` and from `/var/lib/docker`.
4. `id copperflow-hub` lists `copperflow-ws` and `docker`, and the uid is neither 0 nor 10001. Starting the hub as
   root is refused: `sudo node /opt/copperflow/dist/cli.js hub --data /tmp/x --port 0 --public-origin https://x.example
   --workspace-domain ws.x.example --runner container --workspace-image copperflow-workspace:1 --workspace-group <gid>`
   ends with `The container runner refuses to start as root`. (On A, run this with a host Node, or skip it: the
   Compose file sets the user.)
5. As the hub's user, in a checkout with its development dependencies (`npm ci` in `/opt/copperflow`; on A this needs
   Node on the host for this check only): `sudo -u copperflow-hub npx vitest run test/hub-container-engine.test.ts`
   shows every test run and pass, and no line saying the file was skipped.
6. The hub's log has the `Container engine mode:` line, and `cf hub status --data <data>` shows `Runner: container`.
7. By hand: upload a zip with a subfolder, open it in the Studio, and the files load. Delete it; within 10 s
   `ls -A <data>/trash` prints nothing.
8. Delete a project while its download runs: it is either deleted or still listed, never half.
9. With a workspace running: `docker inspect --format '{{.HostConfig.LogConfig.Type}}' cf-ws-<project id>` prints
   `none`. Make it flood stderr for a minute; `du -sh /var/lib/docker` does not grow.
10. With a workspace running, kill the hub hard (A: `docker kill --signal KILL copperflow-hub`; B:
    `systemctl kill --signal=KILL copperflow-hub`). The workspace container ends (`docker ps --filter
    label=org.copperflow.workspace=1` lists nothing within a minute), and after the restart the log says `Removed <n>
    workspace container(s) left from an earlier run.` if any were left.
11. A only: from inside a workspace, the hub's port and Caddy are closed. With a workspace running:
    `docker run --rm --network cf-ws-<project id> node:22-bookworm-slim node -e "require('net').connect(8780, process.argv[1]).on('connect', () => console.log('open')).on('error', (e) => console.log(e.code))" <hub container's address on that network>`
    prints `ECONNREFUSED` (or a reset), and the same with port 443 prints `ECONNREFUSED`. The address is in
    `docker network inspect cf-ws-<project id>`.
12. Run the Studio's build, autoroute and autoplace at once on the 200-part benchmark; afterwards
    `docker inspect --format '{{.State.OOMKilled}}' cf-ws-<project id>` prints `false` (while it runs; the container is
    removed when it stops).
13. The client address reaches the hub: sign in once from outside, then read the audit log (step 11 below); the
    `signin` line's address is your own address, not `127.0.0.1`.
14. `curl -sS -o /dev/null -w '%{http_code}\n' 'https://copperflow.kurpeeren.com/_tls-ask?domain=copperflow.kurpeeren.com'`
    prints `404` (the proxy refuses it; only the proxy itself asks the hub).
15. A backup and its restore test pass (section 13).

## 11. Day to day

**Status.** `cf hub status --data <data>` prints users, projects, unused invite codes, the runner, running
workspaces with each container's memory, trash not yet removed, and disk used by projects. For monitoring,
`cf hub status --data <data> --json` prints one line:

```
{"users":3,"projects":7,"unusedInvites":0,"runner":"container","running":1,"containerMemory":["cf-ws-...: 120MiB / 768MiB"],"trashPending":0,"trashStuck":[],"diskBytes":10485760}
```

`runner` and `running` are `null` when the hub has not written its status file in the last two minutes (it is not
running); `diskBytes` is `null` when the projects could not be measured. Every string has been sanitised.

**Logs.** A: `cfc logs --since 1h hub` and `cfc logs proxy`. B: `journalctl -u copperflow-hub --since -1h`. Workspace
output appears in the hub's log as `workspace <id> output | ...`.

**Resetting a password.** `cf hub reset-password <email> --data <data>` prints a one-time password once; the user's
sessions, tokens and workspaces end within 15 seconds, and they must choose a new password at the next sign-in.

**Deleting a user.** It asks for the email to be typed, so it needs a terminal: A `cfc exec -it hub node
--no-warnings /app/dist/cli.js hub delete-user <email> --data <data>`; B `cf hub delete-user <email> --data <data>`.
Their workspaces stop and their files go within 15 seconds.

**Stopping a workspace.** A workspace stops by itself 15 minutes after its last request. To stop one now:
`cf hub stop-workspace <project id> --data <data>` prints `The running hub stops the workspace of project <id>
within 15 seconds ...`; the hub's sweep stops it as an asked-for stop (not a crash, so it is not restarted), and the
project's next request starts it again. The project id is the 32 hex characters in the Studio's address (`/p/<id>/`)
and in the audit log's detail; the request is audited as `workspace-stop-requested`. Do not use `docker stop` for
this: the hub treats an end it did not ask for as a crash and restarts the workspace once.

**The audit log** is the `audit` table in `hub.db`: time (milliseconds), user id or none, event, address, detail
(a project id, a count or a reason; never a password, cookie, invite code, token or ticket). The events are listed
in docs/hosted.md. The newest 50 (A: prefix with `cfc exec hub`; B: prefix with `sudo -u copperflow-hub`):

```
node --no-warnings -e 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync(process.argv[1], { readOnly: true }); for (const row of db.prepare("SELECT datetime(time / 1000, ?) AS at, user_id, event, address, detail FROM audit ORDER BY id DESC LIMIT 50").all("unixepoch")) console.log(Object.values(row).join("\t"))' /var/lib/copperflow/hub.db
```

Watch for `signin-limited-*`, `signin-strict`, `token-refused`, `upload-refused`, `hub-uncaught-exception`.

## 12. Upgrade and rollback

Upgrade:

1. Back up (section 13) and keep that archive apart: it is the rollback.
2. `git -C /opt/copperflow fetch` and check out the new tag.
3. A: build both images with the next tag (`copperflow-workspace:2`, `copperflow-hub:2`, step 4), set
   `CF_WORKSPACE_IMAGE` and `CF_HUB_IMAGE` to them, `cfc up -d`. B: build the workspace image with the next tag, set
   `CF_WORKSPACE_IMAGE`, `npm ci && npm run build` in `/opt/copperflow`, `systemctl restart copperflow-hub`.
4. Check step 6's lines and `cf hub status --data <data>`.

**The database carries a schema version** (`PRAGMA user_version`; `SCHEMA_VERSION` in `src/hub/store.ts`). It is
set when the database is created and checked every time the hub or a maintainer's command opens it:

- **An older database is migrated** at the first open by the new version: the additive steps it lacks run in order
  (new tables, new columns with defaults; nothing is dropped or rewritten) inside one transaction that also sets the
  new version, so it is either fully migrated or untouched. That is why step 1 above (a backup) comes first.
- **A newer database is refused** with the reason, and nothing in it is changed: `hub.db was written by a newer
  copperflow (schema <n>; this one knows up to <m>). Nothing was changed. Run the newer copperflow, or restore the
  backup taken before the upgrade; before every upgrade, take one with copperflow hub backup ...`.

So an older hub cannot run on a database a newer hub has migrated, and a rollback is:

1. Stop the hub (A: `cfc stop`; B: `systemctl stop copperflow-hub`).
2. Restore the archive taken just before the upgrade (section 13). Accounts, projects and changes made since are lost.
3. Set the image tags back (A) or check out and build the previous tag (B), and start.

The previous images stay on the server until you remove them (`docker image ls copperflow-workspace`).

## 13. Backup and restore

`deploy/backup.sh <data> <destination>` writes `copperflow-<UTC time>.tar.gz` (mode 600), its `.sha256` and a `.log`,
and keeps the newest 14. The database is copied online by `copperflow hub backup` (a consistent snapshot, never a file
copy of the live database); the ticket key and every project folder are archived with tar, links as links, modes and
owners kept. The archive is as sensitive as the data directory: it holds the ticket key and every account's files.
The destination is yours to choose (plan, "For the maintainer to decide", 5); the script only writes to a directory.

Run it as the hub's user. A: with `COPPERFLOW="docker exec copperflow-hub node --no-warnings /app/dist/cli.js"`.

```
sudo -u copperflow-hub COPPERFLOW="..." /opt/copperflow/deploy/backup.sh /var/lib/copperflow /srv/copperflow-backup
```

prints `Wrote /srv/copperflow-backup/copperflow-<time>.tar.gz ({"users":..,"projects":..,"unusedInvites":..}).` Files a
workspace made readable to itself only cannot be read by the hub's user; the script then warns with their number and
the `.log` names them. Nightly, with a systemd timer or cron as that user, for example
`15 3 * * * COPPERFLOW="..." /opt/copperflow/deploy/backup.sh /var/lib/copperflow /srv/copperflow-backup`.

**Restore test** (after the first backup, and monthly): `deploy/restore-test.sh <archive>` checks the `.sha256`,
restores into a scratch directory, runs `hub status --json` on it and compares the counts. It prints
`Restore test passed for <archive>: {...}.` (A: see the script's header for running the hub's image on the scratch
directory.)

**Restore** (the hub stopped):

```
mv /var/lib/copperflow /var/lib/copperflow.broken
install -d -m 700 -o copperflow-hub -g copperflow-hub /var/lib/copperflow
sudo -u copperflow-hub tar --extract --gzip --file <archive> --directory /var/lib/copperflow --preserve-permissions --numeric-owner
sudo -u copperflow-hub rm /var/lib/copperflow/counts.json
cf hub status --data /var/lib/copperflow
```

Start the hub. Files owned by uid 10001 come back owned by the hub's user (only root restores other owners); that is
fine, since the workspace runs in their group with mode 2770 folders.

## 14. When something goes wrong

**The disk fills.** `df -h <data>`; `cf hub status --data <data>` shows disk used by projects and trash not yet
removed. Each user is held to 200 MB and 20 000 entries, measured every 5 seconds; a user over it has their
workspaces stopped. If the data filesystem itself is full: the hub cannot write its database, so stop new uploads by
stopping the hub, look for `<data>/uploads` (stale uploads, removed after an hour) and `<data>/trash` (removal
retried with a growing delay; `hub status` lists folders that failed more than three times), free space, and start
it. If `/var/lib/docker` fills: workspace containers write no logs there (`--log-driver none`); check the hub's and
the proxy's own logs (`max-size 10m`, 5 files in Compose) and old images (`docker image prune`).

**A workspace will not start.** The hub's log says why (`workspace <id>: ...`). Usual causes: the image is missing
(`docker image ls copperflow-workspace`), the user is over quota (the projects page says so), the server's 20
workspaces are taken (503), or the container could not reach its ready line in 60 s (memory pressure:
`free -m`). After a crash it is restarted once, then marked failed until the next request.

**Certificates are not issued (Caddy).** `cfc logs proxy` (A) or `journalctl -u caddy` (B). `/_tls-ask` must answer
200 for the name: from the hub's namespace, A `cfc exec hub node -e "fetch('http://127.0.0.1:8780/_tls-ask?domain=copperflow.kurpeeren.com').then((r) => console.log(r.status))"`,
B `curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:8780/_tls-ask?domain=copperflow.kurpeeren.com'`; it
prints 200 (and 404 for a project id that does not exist). Otherwise: DNS does not point at the server, ports 80/443
are blocked, or the certificate authority's rate limit was reached (wait; do not restart in a loop). nginx: renew with
the DNS challenge (`certbot renew --dry-run`).

**The hub was killed.** Its workspace containers end when their standard input closes (the hub held it). At the next
start the hub removes every `cf-ws-*` and `cf-clean-*` container and network a previous run left and says how many.
To see them meanwhile: `docker ps --all --filter label=org.copperflow.workspace=1`. Do not remove project folders by
hand; the hub's start-up sweep finishes interrupted deletions and uploads.

**The hub restarts in a loop.** Read the first error in its log: a data directory or key with the wrong mode (it says
which `chmod` to run; never 777), the engine too old or not reachable, or the workspace group missing from the hub's
user.
