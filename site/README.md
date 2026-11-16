# The copperflow site

Two static pages: what copperflow is and how to install it (`index.html`), and how to connect an agent and
install the skill (`connect.html`). No accounts, no data, no scripts from other sites.

- `public/` is the whole site. Open `public/index.html` through any static file server to look at it.
- `nginx.conf` serves it with a strict content security policy.
- `compose.yaml` runs it behind an existing Traefik on the external Docker network `coolify`, which issues the
  certificate for `copperflow.kurpeeren.com` with its `letsencrypt` resolver.
- `update.sh` with the two `copperflow-site-update` units keeps the pages on the server equal to this folder on
  `main`.

## Putting it on the server

The name's A record must point at the server first.

```bash
scp -r site <server>:/opt/copperflow-site
ssh <server> 'cd /opt/copperflow-site && docker compose up -d'
curl -sS -o /dev/null -w '%{http_code}' https://copperflow.kurpeeren.com/      # 200
```

## Pages update by themselves

A change to `public/` that reaches `main` is on the site within five minutes. A timer on the server runs `update.sh`
as the user `copperflow-site`, which has no login and can write only the pages: it fetches this public repository
over HTTPS and makes `/opt/copperflow-site/public` equal to `site/public` (files that are gone are removed). Nothing
on GitHub holds a key to the server. A commit without `site/public/index.html` is refused and the pages stay.

Only the pages follow `main`. `nginx.conf`, `compose.yaml` and `update.sh` itself are copied by hand, as root.

To set it up on a new server, as root:

```bash
useradd --system --no-create-home --home-dir /opt/copperflow-site --shell /usr/sbin/nologin copperflow-site
mkdir -p /opt/copperflow-site/repo /opt/copperflow-site/state
chown -R copperflow-site: /opt/copperflow-site/repo /opt/copperflow-site/state /opt/copperflow-site/public
chmod 755 /opt/copperflow-site/update.sh
cp /opt/copperflow-site/copperflow-site-update.* /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now copperflow-site-update.timer
```

To see what it did: `journalctl -u copperflow-site-update.service`. To stop it:
`systemctl disable --now copperflow-site-update.timer`.

The fonts are IBM Plex Sans and IBM Plex Mono under the SIL Open Font License; see the two licence files in `public/fonts/`.
