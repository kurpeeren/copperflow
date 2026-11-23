import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { VERSION } from "../src/version.js"

const ROOT = join(import.meta.dirname, "..")

function text(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
}

function json<T>(file: string): T {
  return JSON.parse(text(file)) as T
}

/** The revision in the title block of a site page: `<dt>Rev</dt>` and the `<dd>` after it. */
function siteRevision(file: string): string | undefined {
  return /<dt>Rev<\/dt>\s*<dd>([^<]*)<\/dd>/.exec(text(file))?.[1]
}

const { version } = json<{ version: string }>("package.json")

test("the program's version is the package's version", () => {
  expect(VERSION).toBe(version)
})

test("every file a release changes carries the package's version", () => {
  const lock = json<{ version: string; packages: Record<string, { version?: string }> }>("package-lock.json")
  const server = json<{ version: string; packages: { version: string }[] }>("server.json")
  const found = {
    "package-lock.json": lock.version,
    "package-lock.json packages[\"\"]": lock.packages[""]?.version,
    "server.json": server.version,
    "server.json packages[0]": server.packages[0]?.version,
    "site/public/index.html": siteRevision("site/public/index.html"),
    "site/public/connect.html": siteRevision("site/public/connect.html"),
    ".claude-plugin/plugin.json": json<{ version: string }>(".claude-plugin/plugin.json").version,
    ".antigravity-plugin/plugin.json": json<{ version: string }>(".antigravity-plugin/plugin.json").version,
  }
  expect(found).toEqual(Object.fromEntries(Object.keys(found).map((file) => [file, version])))
})

test("the marketplace entry leaves the version to the plugin's own manifest", () => {
  const marketplace = json<{ plugins: { name: string; version?: string }[] }>(".claude-plugin/marketplace.json")
  expect(marketplace.plugins.map((plugin) => plugin.version)).toEqual([undefined])
})

test("both plugins start the same MCP server as the registry entry", () => {
  const claude = json<{ mcpServers: Record<string, unknown> }>(".claude-plugin/plugin.json").mcpServers
  const antigravity = json<{ mcpServers: Record<string, unknown> }>("mcp_config.json").mcpServers
  const server = { command: "npx", args: ["-y", "copperflow", "mcp"] }
  expect(claude).toEqual({ copperflow: server })
  expect(antigravity).toEqual({ copperflow: server })
  const registry = json<{ packages: { identifier: string; packageArguments: { value: string }[] }[] }>("server.json")
  expect(registry.packages[0]?.identifier).toBe(server.args[1])
  expect(registry.packages[0]?.packageArguments.map((argument) => argument.value)).toEqual([server.args[2]])
})
