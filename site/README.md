# The copperflow site

Two static pages: what copperflow is and how to install it (`index.html`), and how to connect an agent and
install the skill (`connect.html`). No accounts, no data, no scripts from other
sites.

- `public/` is the whole site. Open `public/index.html` through any static file server to look at it.
- `nginx.conf` serves it with a strict content security policy.
- `compose.yaml` runs it behind an existing Traefik on the external Docker network `coolify`, which issues the
  certificate for `copperflow.kurpeeren.com` with its `letsencrypt` resolver.

## Putting it on the server

The name's A record must point at the server first.

```bash
scp -r site <server>:/opt/copperflow-site
ssh <server> 'cd /opt/copperflow-site && docker compose up -d'
curl -sS -o /dev/null -w '%{http_code}
' https://copperflow.kurpeeren.com/      # 200
```

To update the page, copy `public/` again; nginx serves the new files at once.

The line that says the npm release is in preparation (`#release-note` in `public/index.html` and in
`public/connect.html`) comes out when the package is published.

The fonts are IBM Plex Sans and IBM Plex Mono under the SIL Open Font License; see the two licence files in `public/fonts/`.
