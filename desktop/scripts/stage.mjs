// Builds desktop/stage, the folder the installer packs as the app: the program as npm ships it (dist, library, skills,
// the licence files and its production dependencies, the optional canvas package included) and the desktop main
// process beside it in stage/desktop. Run `npm run build` in the repository root first.
// usage: node scripts/stage.mjs (from desktop/, after `npm run compile`)
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..")
const root = join(desktop, "..")
const stage = join(desktop, "stage")
const FROM_ROOT = ["dist", "library", "skills", "LICENSE", "NOTICE", "package-lock.json"]
const FROM_DESKTOP = ["build", "start", "preload.cjs", "build-resources/icon.ico", "build-resources/icon.png"]

for (const needed of [join(root, "dist", "cli.js"), join(root, "dist", "app", "index.html"), join(desktop, "build", "main.js")]) {
  if (!existsSync(needed)) throw new Error(`${needed} is missing: run npm run build in the repository root and npm run compile here first`)
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, "desktop"), { recursive: true })
for (const entry of FROM_ROOT) cpSync(join(root, entry), join(stage, entry), { recursive: true })
for (const entry of FROM_DESKTOP) cpSync(join(desktop, entry), join(stage, "desktop", entry), { recursive: true })

// The program's own package.json, starting the desktop main process; its scripts are for developing it, not for the app.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
delete pkg.scripts
pkg.main = "desktop/build/main.js"
writeFileSync(join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)

// The same versions the npm package gets, from the lock file; install scripts are not needed by any of them.
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
execFileSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage, stdio: "inherit", shell: process.platform === "win32" })
console.log(`Staged the app in ${stage}`)
