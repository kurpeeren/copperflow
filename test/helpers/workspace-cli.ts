// The CLI as one runnable file for tests that start real `copperflow workspace` child processes: esbuild bundles
// src/cli.ts (packages stay external and resolve from the repository's node_modules), so the tests do not depend on
// a stale dist/. Built once per test file.
import { build } from "esbuild"
import { mkdir } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const REPO = fileURLToPath(new URL("../../", import.meta.url))
let built: Promise<string[]> | undefined

/** The command that runs the CLI: this Node and the bundled file. */
export function workspaceCli(): Promise<string[]> {
  built ??= (async () => {
    const dir = join(REPO, "node_modules", ".cache", "copperflow-test-cli")
    await mkdir(dir, { recursive: true })
    const file = join(dir, `cli-${process.pid}-${randomBytes(4).toString("hex")}.mjs`)
    await build({ entryPoints: [join(REPO, "src", "cli.ts")], bundle: true, platform: "node", format: "esm", packages: "external", outfile: file, logLevel: "silent" })
    return [process.execPath, file]
  })()
  return built
}
