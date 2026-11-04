import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react(), thirdPartyLicenses()],
  build: {
    outDir: fileURLToPath(new URL("../dist/app", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
})

/**
 * Writes THIRD_PARTY_LICENSES.txt next to the app with the name, version, licence and licence
 * text of every package bundled into it, as their licences (MIT, ISC, ...) require.
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: "copperflow-third-party-licenses",
    generateBundle(_options, bundle) {
      const dirs = new Set<string>()
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue
        for (const id of output.moduleIds ?? Object.keys(output.modules)) {
          const dir = packageDir(id)
          if (dir) dirs.add(dir)
        }
      }
      const sections = [...dirs]
        .map((dir) => describe(dir))
        .filter((entry): entry is { key: string; text: string } => entry !== undefined)
        .sort((a, b) => a.key.localeCompare(b.key))
      const header = "copperflow studio bundles the following packages. Their licences follow.\n"
      this.emitFile({ type: "asset", fileName: "THIRD_PARTY_LICENSES.txt", source: [header, ...sections.map((s) => s.text)].join("\n") })
    },
  }
}

/** The package folder of a bundled module, using its last node_modules segment. */
function packageDir(id: string): string | undefined {
  const path = id.replace(/^\0/, "").split("?")[0] ?? ""
  const parts = path.split(/[\\/]/)
  const index = parts.lastIndexOf("node_modules")
  if (index === -1 || index + 1 >= parts.length) return undefined
  const scoped = parts[index + 1]?.startsWith("@")
  return parts.slice(0, index + (scoped ? 3 : 2)).join("/")
}

function describe(dir: string): { key: string; text: string } | undefined {
  const manifest = join(dir, "package.json")
  if (!existsSync(manifest)) return undefined
  const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; version?: string; license?: string }
  const file = readdirSync(dir).find((name) => /^(licen[cs]e|copying)/i.test(name))
  const text = file ? readFileSync(join(dir, file), "utf8").trim() : "(no licence file in the package)"
  const key = `${pkg.name}@${pkg.version}`
  return { key, text: `${"=".repeat(72)}\n${key}  ${pkg.license ?? "licence not stated in package.json"}\n${"=".repeat(72)}\n${text}\n` }
}
