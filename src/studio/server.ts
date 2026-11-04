import { randomBytes, timingSafeEqual } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { z, ZodError } from "zod"
import {
  BUILTIN_PARTS,
  buildBom,
  exportPackage,
  listParts,
  partDir,
  placePart,
  readPart,
  verifyPart,
  addMark,
  editCircuit,
  EditError,
  isInside,
  listCircuits,
  listEntries,
  loadCircuit,
  lockParts,
  removeMark,
  undoChange,
  unlockParts,
  updateAnnotations,
} from "../core/index.js"
import { Evaluator, findTscircuitEval } from "./evaluator.js"
import { LiveProject } from "./live.js"

export interface StudioOptions {
  root: string
  /** 0 picks a free port. */
  port?: number
  /** Folder with the built browser app; defaults to dist/app. */
  staticDir?: string
  buildCommand?: string[]
  /**
   * Build with the installed tscircuit's eval library in a long-lived worker (seconds per build
   * instead of the CLI's start-up). On by default unless a build command or COPPERFLOW_TSCI is set.
   */
  fastBuild?: boolean
  /** Open event streams allowed at once. */
  maxStreams?: number
}

export interface Studio {
  url: string
  token: string
  /** The address to open: the token travels in the fragment, which browsers never send. */
  openUrl: string
  close(): Promise<void>
}

const DEFAULT_PORT = 4777
const DEFAULT_MAX_STREAMS = 16
const MAX_CONNECTIONS = 64
const REQUEST_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 1024 * 1024
const HEARTBEAT_MS = 25_000
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
}
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
}

const literal = z.union([z.string().max(500), z.number(), z.boolean()])
const props = z.record(z.string().max(64), literal)
const file = z.string().min(1).max(500)
const EditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setProps"), part: z.string(), props }),
  z.object({ kind: z.literal("removePart"), part: z.string() }),
  z.object({ kind: z.literal("addTrace"), from: z.string(), to: z.string(), props: props.optional() }),
  z.object({ kind: z.literal("removeTrace"), from: z.string(), to: z.string() }),
])
const Bodies = {
  edit: z.object({ file, summary: z.string().min(1).max(200), edits: z.array(EditSchema).min(1).max(50) }),
  lock: z.object({ file, parts: z.array(z.string()).min(1).max(200), locked: z.boolean() }),
  mark: z.object({
    file,
    text: z.string().min(1).max(500),
    view: z.enum(["pcb", "schematic"]).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  unmark: z.object({ file, id: z.string() }),
  undo: z.object({ id: z.string().optional() }),
  build: z.object({ file }),
  place: z.object({ file, part: z.string().min(1).max(64), name: z.string().max(40).optional(), props: props.optional() }),
  verify: z.object({ id: z.string().min(1).max(64), by: z.string().min(1).max(100), against: z.string().min(1).max(300), confirm: z.string() }),
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Starts the Studio web server on 127.0.0.1. */
export async function startStudio(options: StudioOptions): Promise<Studio> {
  const root = resolve(options.root)
  const staticDir = resolve(options.staticDir ?? fileURLToPath(new URL("../app/", import.meta.url)))
  const token = randomBytes(24).toString("hex")
  const customCli = options.buildCommand !== undefined || Boolean(process.env.COPPERFLOW_TSCI)
  const evalEntry = (options.fastBuild ?? !customCli) ? findTscircuitEval() : undefined
  const fast = evalEntry ? new Evaluator(evalEntry) : undefined
  const live = new LiveProject(root, options.buildCommand, fast)
  const streams = new Set<ServerResponse>()
  const maxStreams = options.maxStreams ?? DEFAULT_MAX_STREAMS
  let port = 0

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => sendError(res, error, root))
  })
  server.requestTimeout = REQUEST_TIMEOUT_MS
  server.maxConnections = MAX_CONNECTIONS

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "Unexpected Host header")
    const origin = req.headers.origin
    if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      throw new HttpError(403, "Cross-origin requests are not allowed")
    }
    const url = new URL(req.url ?? "/", `http://${host}`)
    if (!url.pathname.startsWith("/api/")) return serveStatic(url.pathname, res)

    const given = req.headers["x-copperflow-token"]
    if (typeof given !== "string" || !sameToken(given, token)) throw new HttpError(403, "Missing or wrong session token")

    const route = `${req.method} ${url.pathname}`
    const query = (name: string) => {
      const value = url.searchParams.get(name)
      if (!value) throw new HttpError(400, `Missing ${name}`)
      return value
    }
    switch (route) {
      case "GET /api/events":
        return openEvents(res)
      case "GET /api/circuits":
        return send(res, await listCircuits(root))
      case "GET /api/circuit": {
        const { model, annotations, violations, file: name } = await loadCircuit(root, query("file"))
        return send(res, { file: name, model, annotations, violations })
      }
      case "GET /api/build":
        return send(res, live.getBuild((await loadCircuit(root, query("file"))).file))
      case "GET /api/history":
        return send(res, await listEntries(root, Number(url.searchParams.get("limit") ?? 50) || 50))
      case "POST /api/build": {
        const body = Bodies.build.parse(await readJson(req))
        live.requestBuild((await loadCircuit(root, body.file)).file)
        return send(res, { status: "building" }, 202)
      }
      case "POST /api/edit": {
        const body = Bodies.edit.parse(await readJson(req))
        const result = await editCircuit(root, body.file, body.edits, { author: "human", summary: body.summary })
        return send(res, { entryId: result.entry.id, violations: result.violations })
      }
      case "POST /api/lock": {
        const body = Bodies.lock.parse(await readJson(req))
        const { model } = await loadCircuit(root, body.file)
        const now = new Date().toISOString()
        const next = await updateAnnotations(root, body.file, (a) =>
          body.locked ? lockParts(a, model, body.parts, now) : unlockParts(a, body.parts),
        )
        return send(res, next)
      }
      case "POST /api/mark": {
        const { file: name, ...input } = Bodies.mark.parse(await readJson(req))
        let id = ""
        await updateAnnotations(root, name, (a) => {
          const result = addMark(a, input, new Date().toISOString())
          id = result.mark.id
          return result.annotations
        })
        return send(res, { id })
      }
      case "POST /api/unmark": {
        const body = Bodies.unmark.parse(await readJson(req))
        return send(res, await updateAnnotations(root, body.file, (a) => removeMark(a, body.id)))
      }
      case "GET /api/parts":
        return send(res, { library: await listParts(root), builtin: BUILTIN_PARTS })
      case "GET /api/part": {
        const id = query("id")
        const part = await readPart(root, id)
        const checklist = await readFile(resolve(partDir(root, id), "verification.md"), "utf8").catch(() => "")
        return send(res, { id, part, checklist })
      }
      case "POST /api/place": {
        const { file: name, ...request } = Bodies.place.parse(await readJson(req))
        const result = await placePart(root, name, request, { author: "human" })
        return send(res, { entryId: result.entry.id, name: result.name })
      }
      case "POST /api/verify": {
        const body = Bodies.verify.parse(await readJson(req))
        // The person types the id back, as in the CLI, so a stray click cannot verify a part.
        if (body.confirm.trim() !== body.id) throw new HttpError(400, `Type ${body.id} exactly to confirm`)
        await verifyPart(root, body.id, { by: body.by, against: body.against }, new Date().toISOString())
        return send(res, { id: body.id })
      }
      case "GET /api/bom": {
        const circuit = (await loadCircuit(root, query("file"))).file
        return send(res, await buildBom(root, circuit, live.getBuild(circuit).circuitJson))
      }
      case "POST /api/package": {
        const circuit = (await loadCircuit(root, Bodies.build.parse(await readJson(req)).file)).file
        const json = live.getBuild(circuit).circuitJson
        return send(res, await exportPackage(root, circuit, json ? { circuitJson: json } : {}))
      }
      case "POST /api/undo": {
        const body = Bodies.undo.parse(await readJson(req))
        const entry = await undoChange(root, { author: "human", ...(body.id ? { id: body.id } : {}) })
        return send(res, { entryId: entry.id, summary: entry.summary })
      }
      default:
        throw new HttpError(404, `No route ${route}`)
    }
  }

  async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      throw new HttpError(400, "Bad path")
    }
    const relative = decoded === "/" ? "index.html" : decoded.slice(1)
    const path = resolve(staticDir, relative)
    if (decoded.includes("\0") || !isInside(staticDir, path)) throw new HttpError(404, "Not found")
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile()) throw new HttpError(404, "Not found")
    const type = TYPES[extname(path)] ?? "application/octet-stream"
    res.writeHead(200, { "content-type": type, "cache-control": "no-store", ...SECURITY_HEADERS })
    res.end(await readFile(path))
  }

  function openEvents(res: ServerResponse): void {
    if (streams.size >= maxStreams) throw new HttpError(429, "Too many open event streams")
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      ...SECURITY_HEADERS,
    })
    res.write(": connected\n\n")
    streams.add(res)
    const unsubscribe = live.subscribe((event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS)
    res.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
      streams.delete(res)
    })
  }

  await new Promise<void>((done, fail) => {
    server.once("error", fail)
    server.listen(options.port ?? DEFAULT_PORT, "127.0.0.1", () => done())
  })
  const address = server.address()
  port = typeof address === "object" && address ? address.port : 0
  live.start()
  fast?.warm()

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    openUrl: `http://127.0.0.1:${port}/#token=${token}`,
    close: async () => {
      live.stop()
      await fast?.stop()
      for (const stream of streams) stream.end()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

function send(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS })
  res.end(JSON.stringify({ ok: true, data }))
}

function sendError(res: ServerResponse, error: unknown, root: string): void {
  // Node system errors (EPERM, ENOENT, ...) carry a string code and paths; they are not user errors.
  const unexpected = !(error instanceof EditError) && typeof (error as { code?: unknown })?.code === "string"
  if (unexpected) console.error("copperflow studio:", error)
  const status = unexpected
    ? 500
    : error instanceof HttpError
      ? error.status
      : error instanceof EditError
        ? { locked: 409, readonly: 409, not_found: 404, invalid: 400, parse: 400 }[error.code]
        : 400
  const message = unexpected
    ? "Internal error; see the terminal running copperflow studio"
    : error instanceof ZodError
      ? error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")
      : (error as Error).message.split(root).join(".")
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS })
  res.end(JSON.stringify({ ok: false, error: message }))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large")
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
