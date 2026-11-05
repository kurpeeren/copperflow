import { posix } from "node:path"
import { compileFunction, createContext } from "node:vm"
import { transformSync, type Loader, type Message } from "esbuild"
import { createRuntime, isElement, type CfElement, type ComponentFunction } from "./jsx-runtime.js"

export class CircuitCodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "CircuitCodeError"
  }
}

export interface Evaluated {
  root: CfElement
  /** Project path of the module that exported the function. */
  definedIn(fn: ComponentFunction): string | undefined
}

interface ModuleRecord {
  exports: unknown
}

const LOADERS: Readonly<Record<string, Loader>> = { ".tsx": "tsx", ".ts": "ts", ".jsx": "jsx", ".js": "js" }
const EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", ".json", "/index.tsx", "/index.ts"]
const RUNTIME_SPECIFIERS = new Set(["copperflow", "copperflow/jsx-runtime", "copperflow/jsx-dev-runtime"])
const CACHE_LIMIT = 500

const transpiled = new Map<string, string>()

function transpile(path: string, text: string): string {
  const key = `${path}\0${text}`
  const cached = transpiled.get(key)
  if (cached !== undefined) return cached
  let code: string
  try {
    code = transformSync(text, {
      loader: LOADERS[posix.extname(path)] ?? "js",
      format: "cjs",
      jsx: "automatic",
      jsxDev: true,
      jsxImportSource: "copperflow",
      sourcefile: path,
    }).code
  } catch (error) {
    throw esbuildFailure(path, error)
  }
  if (transpiled.size >= CACHE_LIMIT) transpiled.delete(transpiled.keys().next().value as string)
  transpiled.set(key, code)
  return code
}

function esbuildFailure(path: string, error: unknown): Error {
  const first = (error as { errors?: Message[] }).errors?.[0]
  if (!first) return error instanceof Error ? error : new Error(String(error))
  const where = first.location ? `${path}:${first.location.line}:${first.location.column + 1}: ` : `${path}: `
  return new CircuitCodeError(where + first.text)
}

/** Runs circuit code; anything it throws becomes a host-realm CircuitCodeError that names the file. */
function inFile<T>(path: string, task: () => T): T {
  try {
    return task()
  } catch (error) {
    if (error instanceof CircuitCodeError) throw error
    const message = (error as { message?: unknown } | null)?.message
    throw new CircuitCodeError(`${path}: ${typeof message === "string" ? message : String(error)}`, { cause: error })
  }
}

function parseJson(path: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new CircuitCodeError(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function resolveRelative(files: Readonly<Record<string, string>>, from: string, specifier: string): string {
  const target = posix.normalize(posix.join(posix.dirname(from), specifier))
  if (target === ".." || target.startsWith("../")) throw new CircuitCodeError(`${from}: "${specifier}" is outside the project`)
  for (const extension of EXTENSIONS) if (files[target + extension] !== undefined) return target + extension
  throw new CircuitCodeError(`${from}: cannot find "${specifier}"`)
}

export function evaluateCircuit(files: Readonly<Record<string, string>>, main: string): Evaluated {
  const entry = posix.normalize(main)
  // A guard against mistakes, not a security boundary: circuit code gets no `process`, Node `require` or
  // `fetch` by accident, but deliberately hostile code can still escape this context. There is no time
  // limit here either; the caller enforces one.
  const context = createContext({ console })
  const runtime = createRuntime(files)
  const modules = new Map<string, ModuleRecord>()
  const origins = new Map<Function, string>()

  function load(path: string): unknown {
    const known = modules.get(path)
    if (known) return known.exports
    const text = files[path]
    if (text === undefined) throw new CircuitCodeError(`cannot find "${path}"`)
    const record: ModuleRecord = { exports: {} }
    modules.set(path, record)
    if (path.endsWith(".json")) record.exports = parseJson(path, text)
    else run(path, transpile(path, text), record)
    recordOrigins(path, record.exports)
    return record.exports
  }

  function run(path: string, code: string, record: ModuleRecord): void {
    const fn = compileFunction(code, ["exports", "require", "module"], { filename: path, parsingContext: context })
    inFile(path, () => fn(record.exports, (specifier: string) => requireFrom(path, specifier), record))
  }

  function recordOrigins(path: string, exported: unknown): void {
    if (typeof exported !== "object" || exported === null) return
    for (const value of Object.values(exported)) if (typeof value === "function" && !origins.has(value)) origins.set(value, path)
  }

  function requireFrom(from: string, specifier: string): unknown {
    if (RUNTIME_SPECIFIERS.has(specifier)) return runtime
    if (specifier.startsWith("./") || specifier.startsWith("../")) return load(resolveRelative(files, from, specifier))
    throw new CircuitCodeError(`${from}: imports may name only project files and copperflow; "${specifier}" is not allowed`)
  }

  const exported = (load(entry) as Record<string, unknown>)["default"]
  const root = typeof exported === "function" ? inFile(entry, () => (exported as ComponentFunction)({})) : exported
  if (!isElement(root)) throw new CircuitCodeError(`${entry} must export default a function that returns <board>`)
  return { root, definedIn: (fn) => origins.get(fn) }
}
