// The deployment files under deploy/ checked against the code, so they cannot drift from the hub's real options.
import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const read = (path: string) => readFileSync(ROOT + path, "utf8")

const COMPOSE = "deploy/compose.yaml"
const UNIT = "deploy/copperflow-hub.service"
const TEMPLATE = "deploy/hub.env.example"
const CADDY = "deploy/Caddyfile"
const NGINX = "deploy/nginx.conf.example"
const SCRIPTS = ["deploy/backup.sh", "deploy/restore-test.sh"]
const ALL = [COMPOSE, UNIT, TEMPLATE, CADDY, NGINX, "deploy/hub.Dockerfile", "deploy/README.md", ...SCRIPTS]

/** Every `--option` the hub's command line knows: the string literals in src/hub/commands.ts. */
function knownFlags(): Set<string> {
  return new Set([...read("src/hub/commands.ts").matchAll(/"(--[a-z][a-z-]*)"/g)].map((match) => match[1] as string))
}

/** Lines that are not comments (# in YAML, the unit, the template and the shell scripts). */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")

/** The names the template defines, with their values. */
function templateValues(): Map<string, string> {
  const values = new Map<string, string>()
  for (const line of read(TEMPLATE).split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (match) values.set(match[1] as string, match[2] as string)
  }
  return values
}

/** Environment names a file uses: ${NAME...} (Compose, systemd, envsubst) and {$NAME} (Caddy). */
function namesUsed(text: string): string[] {
  return [...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)|\{\$([A-Z][A-Z0-9_]*)\}/g)].map((match) => (match[1] ?? match[2]) as string)
}

describe("deploy/ against the code", () => {
  test("every --flag in the Compose file, the systemd unit and the template is one the hub knows", () => {
    const known = knownFlags()
    expect(known.has("--workspace-reach")).toBe(true)
    for (const path of [COMPOSE, UNIT, TEMPLATE]) {
      const used = [...read(path).matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)].map((match) => match[1] as string)
      expect(used.length, path).toBeGreaterThan(0)
      expect(used.filter((flag) => !known.has(flag)), path).toEqual([])
    }
  })

  test("every environment name a file uses is defined once in the template, and the template defines nothing unused", () => {
    const defined = templateValues()
    const lines = read(TEMPLATE).split("\n").filter((line) => /^[A-Z]/.test(line))
    expect(new Set(lines.map((line) => line.split("=")[0])).size).toBe(lines.length)
    const used = new Set<string>()
    for (const path of [COMPOSE, UNIT, CADDY, NGINX]) {
      for (const name of namesUsed(code(read(path)))) {
        expect(defined.has(name), `${path} uses ${name}`).toBe(true)
        used.add(name)
      }
    }
    expect([...defined.keys()].filter((name) => !used.has(name))).toEqual([])
  })

  test("the template holds no secret, and the values that must be chosen are empty", () => {
    const values = templateValues()
    expect([...values.keys()].filter((name) => /KEY|SECRET|PASSWORD|TOKEN/.test(name))).toEqual([])
    for (const name of ["CF_WORKSPACE_DOMAIN", "CF_HUB_UID", "CF_HUB_GID", "CF_WORKSPACE_GID", "CF_DOCKER_GID"]) expect(values.get(name), name).toBe("")
    expect(values.get("CF_PUBLIC_HOST")).toBe("copperflow.kurpeeren.com")
    // The ticket key is made by the hub in the data directory; no file names a secret to pass in.
    for (const path of ALL) expect(read(path), path).not.toMatch(/PRIVATE KEY-----|COPPERFLOW_TICKET_PUBLIC_KEY=/)
  })

  test("the Compose file runs the hub in a container with the proxy in its network namespace", () => {
    const compose = parse(read(COMPOSE)) as { services: Record<string, Record<string, unknown>> }
    const hub = compose.services.hub as Record<string, unknown>
    const proxy = compose.services.proxy as Record<string, unknown>
    const command = (hub.command as string[]).join(" ")
    expect(command).toMatch(/^hub --data /)
    for (const part of ["--runner container", "--workspace-reach network", "--hub-container ${CF_HUB_CONTAINER}", "--bind 127.0.0.1", "--trust-proxy 127.0.0.1"]) expect(command).toContain(part)
    expect(proxy.network_mode).toBe("service:hub")
    expect(hub.ports).toEqual(["80:80", "443:443"])
    expect(proxy.ports).toBeUndefined()
    expect(hub.restart).toBe("unless-stopped")
    expect(proxy.restart).toBe("unless-stopped")
    expect(JSON.stringify(hub.healthcheck)).toContain("/healthz")
    expect(hub.container_name).toBe("${CF_HUB_CONTAINER}")
    // The data directory at the same path inside as outside: the host's engine mounts project folders by that path.
    expect(hub.volumes).toContain("${CF_DATA_DIR}:${CF_DATA_DIR}")
    expect(hub.user).toMatch(/^\$\{CF_HUB_UID:\?[^}]*\}:\$\{CF_HUB_GID:\?[^}]*\}$/)
    expect(hub.volumes).toContain("/var/run/docker.sock:/var/run/docker.sock")
    expect(hub.cap_drop).toEqual(["ALL"])
  })

  test("the systemd unit runs the hub on the host with loopback reach and writes only its data directory", () => {
    const unit = read(UNIT)
    expect(unit).toMatch(/^User=copperflow-hub$/m)
    expect(unit).toMatch(/^SupplementaryGroups=copperflow-ws docker$/m)
    expect(unit).toMatch(/^NoNewPrivileges=yes$/m)
    expect(unit).toMatch(/^ProtectSystem=strict$/m)
    expect(unit).toMatch(/--workspace-reach loopback/)
    expect(unit).not.toMatch(/--hub-container/)
    // ReadWritePaths cannot read the environment file, so it names the template's data directory itself.
    expect(unit).toContain(`ReadWritePaths=${templateValues().get("CF_DATA_DIR")}`)
  })

  test("the Caddyfile has every required directive", () => {
    const caddy = code(read(CADDY))
    expect(caddy).toContain("on_demand")
    expect(caddy).toMatch(/ask http:\/\/127\.0\.0\.1:\{\$CF_HUB_PORT\}\/_tls-ask/)
    expect(caddy).toContain("flush_interval -1")
    expect(caddy).toMatch(/max_size 210MB/)
    expect(caddy).toContain("header_up Host {host}")
    expect(caddy).toContain("header_up X-Forwarded-For {remote_host}")
    expect(caddy).toMatch(/@tlsask path \/_tls-ask\*\s+respond @tlsask 404/)
    expect(caddy).toContain("*.{$CF_WORKSPACE_DOMAIN}")
  })

  test("the nginx example has every required directive and never appends a client's X-Forwarded-For", () => {
    const nginx = read(NGINX)
    for (const directive of ["proxy_buffering off", "client_max_body_size 210m", "proxy_set_header Host $host", "proxy_set_header X-Forwarded-For $remote_addr", "proxy_read_timeout", "limit_conn perclient", "return 301 https://$host$request_uri", "location = /_tls-ask"]) {
      expect(nginx, directive).toContain(directive)
    }
    expect(nginx).not.toContain("$proxy_add_x_forwarded_for")
    expect(nginx).toMatch(/server_name \*\.\$\{CF_WORKSPACE_DOMAIN\}/)
  })

  test("the shell scripts are strict, never eval, and refuse root unless told", () => {
    for (const path of SCRIPTS) {
      const script = read(path)
      expect(script.startsWith("#!/usr/bin/env bash\n"), path).toBe(true)
      expect(script, path).toContain("set -euo pipefail")
      expect(code(script), path).not.toMatch(/\beval\b/)
      expect(script, path).toMatch(/id -u.*-eq 0/)
      expect(script, path).toContain("--allow-root")
      expect(script, path).toMatch(/untested on the maintainer's server/)
    }
    expect(read("deploy/backup.sh")).toContain("hub backup")
    expect(read("deploy/restore-test.sh")).toContain("hub status --json")
  })

  test("every file is LF only", () => {
    for (const path of ALL) expect(read(path).includes("\r"), path).toBe(false)
  })
})
