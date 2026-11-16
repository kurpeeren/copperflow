#!/usr/bin/env node
// Has an agent build each bench brief headless through this checkout's MCP server, then measures the project.
// node bench/run.mjs [--brief can-node] [--model haiku] [--runs 1] [--out bench/results] [--timeout-min 20]
import { spawn, spawnSync } from "node:child_process"
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { startServer } from "./mcp-client.mjs"
import { countInstances, parseBoardSize, parseProjectStatus, parseTranscript, summaryMarkdown } from "./lib.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..")
const CLI = join(REPO, "dist", "cli.js")
const IS_WINDOWS = process.platform === "win32"
const MEASURE_TIMEOUT_MS = 10 * 60_000

function options(argv) {
  const found = { brief: null, model: "haiku", runs: 1, out: join(REPO, "bench", "results"), timeoutMin: 20 }
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    if (flag === "--brief") found.brief = value
    else if (flag === "--model") found.model = value
    else if (flag === "--runs") found.runs = Number(value)
    else if (flag === "--out") found.out = resolve(value)
    else if (flag === "--timeout-min") found.timeoutMin = Number(value)
    else throw new Error(`Unknown option ${flag}`)
  }
  if (!Number.isInteger(found.runs) || found.runs < 1) throw new Error("--runs must be a whole number of at least 1")
  if (!(found.timeoutMin > 0)) throw new Error("--timeout-min must be above 0")
  return found
}

function briefs(only) {
  const folder = join(HERE, "briefs")
  const names = readdirSync(folder).filter((name) => name.endsWith(".md")).map((name) => basename(name, ".md")).sort()
  if (only === null) return names
  if (!names.includes(only)) throw new Error(`No brief ${only}; there are ${names.join(", ")}`)
  return [only]
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, "-").replace(/\..*$/, "")

/** The arguments the agent is started with; see bench/README.md for why each is there. */
export function agentArgs(model, mcpConfigPath) {
  return [
    "-p",
    "--model", model,
    "--output-format", "stream-json",
    "--verbose",
    "--mcp-config", mcpConfigPath,
    "--strict-mcp-config",
    "--tools", "",
    "--allowedTools", "mcp__copperflow",
    "--permission-mode", "dontAsk",
    "--setting-sources", "project",
    "--disable-slash-commands",
    "--no-chrome",
    "--no-session-persistence",
  ]
}

/** Starts the `claude` program; on Windows through the shell, so the npm .cmd shim is found. */
function startAgent(args, cwd) {
  if (!IS_WINDOWS) return spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
  const quoted = args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`)
  return spawn(["claude", ...quoted].join(" "), { cwd, stdio: ["pipe", "pipe", "pipe"], shell: true })
}

function stopTree(child) {
  if (IS_WINDOWS) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  else child.kill("SIGTERM")
}

async function runAgent(prompt, model, project, runDir, timeoutMin) {
  const mcpConfigPath = join(runDir, "mcp.json")
  const config = { mcpServers: { copperflow: { command: process.execPath, args: [CLI, "mcp", "--root", project] } } }
  writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`)
  const args = agentArgs(model, mcpConfigPath)
  writeFileSync(join(runDir, "command.txt"), `claude ${args.map((a) => (a === "" ? '""' : a)).join(" ")}  (prompt on stdin, cwd ${project})\n`)
  const started = Date.now()
  const child = startAgent(args, project)
  const transcript = createWriteStream(join(runDir, "transcript.jsonl"))
  const stderr = createWriteStream(join(runDir, "stderr.txt"))
  child.stdout.pipe(transcript)
  child.stderr.pipe(stderr)
  child.stdin.end(prompt)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    stopTree(child)
  }, timeoutMin * 60_000)
  const exitCode = await new Promise((done) => {
    child.on("error", () => done(-1))
    child.on("close", (code) => done(code))
  })
  clearTimeout(timer)
  await Promise.all([new Promise((d) => transcript.end(d)), new Promise((d) => stderr.end(d))])
  return { timedOut, exitCode, wallMs: Date.now() - started }
}

function filesUnder(folder, test, out = []) {
  for (const name of readdirSync(folder)) {
    if (name === "node_modules" || name === ".copperflow") continue
    const path = join(folder, name)
    if (statSync(path).isDirectory()) filesUnder(path, test, out)
    else if (test(name)) out.push(path)
  }
  return out
}

function cli(project, args) {
  const result = spawnSync(process.execPath, [CLI, ...args, "--root", project], { encoding: "utf8", timeout: MEASURE_TIMEOUT_MS })
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

const sum = (circuits, key) => (circuits.some((c) => typeof c[key] === "number") ? circuits.reduce((t, c) => t + (c[key] ?? 0), 0) : null)

export async function measure(project, runDir) {
  const rel = (path) => relative(project, path).split("\\").join("/")
  const circuitFiles = filesUnder(project, (n) => n.endsWith(".circuit.tsx")).map(rel)
  const sheetFiles = filesUnder(project, (n) => n.endsWith(".sheet.tsx")).map(rel)
  const fabByAgent = filesUnder(project, (n) => n.endsWith("-fab.zip")).map(rel)
  const found = { circuitFiles, sheets: sheetFiles.length, fabByAgent, circuits: [], boards: {}, checks: {}, exports: {}, renders: {} }
  if (circuitFiles.length === 0) return { ...found, parts: null, nets: null, instances: null, unrouted: null, errors: null, warnings: null, fabFiles: fabByAgent.length > 0, exportWrote: null }
  const server = await startServer(CLI, project)
  try {
    found.circuits = parseProjectStatus((await server.call("project_status")).text)
    for (const file of circuitFiles) {
      const board = await server.call("board_summary", { file })
      found.boards[file] = board.isError ? { error: board.text.slice(0, 200) } : parseBoardSize(board.text)
    }
  } finally {
    server.close()
  }
  let instances = 0
  for (const file of circuitFiles) {
    instances += countInstances(cli(project, ["summary", file]).out)
    const check = cli(project, ["check", file])
    found.checks[file] = { exit: check.code, first: check.out.split("\n")[0] }
    const exported = cli(project, ["export", file, "--out", "bench-export"])
    found.exports[file] = { exit: exported.code, text: exported.out.slice(0, 400) }
    // render writes only inside the project, so the picture is drawn there and copied beside the results.
    const name = `${basename(file, ".circuit.tsx")}-pcb.png`
    const drawn = join(project, "bench-render", name)
    const render = cli(project, ["render", file, "--out", `bench-render/${name}`])
    if (render.code === 0 && existsSync(drawn)) {
      copyFileSync(drawn, join(runDir, name))
      found.renders[file] = name
    } else found.renders[file] = `failed: ${render.out.slice(0, 200)}`
  }
  const exportWrote = Object.values(found.exports).some((e) => e.exit === 0)
  return {
    ...found,
    parts: sum(found.circuits, "parts"),
    nets: sum(found.circuits, "nets"),
    instances,
    unrouted: sum(found.circuits, "unrouted"),
    errors: sum(found.circuits, "errors"),
    warnings: sum(found.circuits, "warnings"),
    fabFiles: fabByAgent.length > 0,
    exportWrote,
  }
}

async function oneRun(brief, model, run, invocationDir, timeoutMin) {
  const runDir = join(invocationDir, `${brief}-${model}-${run}`)
  const project = join(runDir, "project")
  mkdirSync(project, { recursive: true })
  const prompt = readFileSync(join(HERE, "briefs", `${brief}.md`), "utf8")
  console.log(`${brief} ${model} run ${run}: agent started in ${project}`)
  const agent = await runAgent(prompt, model, project, runDir, timeoutMin)
  const transcript = parseTranscript(readFileSync(join(runDir, "transcript.jsonl"), "utf8"))
  const ended = agent.timedOut ? "timed out" : transcript.ended === "no result" ? `error: exit ${agent.exitCode}` : transcript.ended
  console.log(`${brief} ${model} run ${run}: ${ended} after ${(agent.wallMs / 60_000).toFixed(1)} min, measuring`)
  let project_
  try {
    project_ = await measure(project, runDir)
  } catch (error) {
    project_ = { error: String(error.message ?? error), parts: null, instances: null, unrouted: null, errors: null, warnings: null, fabFiles: null }
  }
  const result = { brief, model, run, ended, minutes: agent.wallMs / 60_000, exitCode: agent.exitCode, transcript, project: project_ }
  writeFileSync(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

async function main() {
  const opts = options(process.argv.slice(2))
  if (!existsSync(CLI)) throw new Error(`${CLI} is missing: run npm run build first`)
  const invocationDir = join(opts.out, stamp())
  mkdirSync(invocationDir, { recursive: true })
  const results = []
  for (const brief of briefs(opts.brief)) {
    for (let run = 1; run <= opts.runs; run++) {
      results.push(await oneRun(brief, opts.model, run, invocationDir, opts.timeoutMin))
      writeFileSync(join(invocationDir, "summary.md"), summaryMarkdown(results))
    }
  }
  console.log(readFileSync(join(invocationDir, "summary.md"), "utf8"))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`bench: ${error.message}`)
    process.exit(1)
  })
}
