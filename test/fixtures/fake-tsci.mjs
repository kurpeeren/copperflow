// Stands in for the tscircuit CLI in tests. Usage: fake-tsci.mjs build <file>
// Behaviour comes from <file>.fake.json: { exitCode, print, printCwd, sleepMs, elements, rawJson, announce }.
// When `elements` (or `rawJson`) is present, it is written as circuit JSON and announced like
// tsci does; `announce` replaces the announced path.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"

const [command, file] = process.argv.slice(2)
if (command !== "build" || !file) {
  console.error("usage: fake-tsci build <file>")
  process.exit(2)
}
const spec = JSON.parse(readFileSync(file.replace(/\.tsx$/, ".fake.json"), "utf8"))
for (const line of spec.print ?? []) console.log(line)
if (spec.printCwd) console.log(`Error in ${process.cwd()}${process.platform === "win32" ? "\\" : "/"}main.circuit.tsx`)
if (spec.sleepMs) await new Promise((done) => setTimeout(done, spec.sleepMs))
if (spec.elements || spec.rawJson) {
  const out = join("dist", dirname(file), basename(file).replace(/\.circuit\.tsx$/, ""), "circuit.json")
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, spec.rawJson ?? JSON.stringify(spec.elements))
  console.log(`\u001b[32mCircuit JSON written to ${spec.announce ?? out}\u001b[0m`)
}
process.exit(spec.exitCode ?? 0)
