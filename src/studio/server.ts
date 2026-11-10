import { randomBytes, timingSafeEqual } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { basename, extname, resolve } from "node:path"
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
  applyLayoutEdits,
  circuitPathFor,
  editCircuit,
  EditError,
  isInside,
  isLayoutFile,
  listCircuits,
  listSheets,
  listHistory,
  loadCircuit,
  lockParts,
  makeSubSheet,
  previewSubSheet,
  redoChange,
  removeMark,
  resolveCircuit,
  undoChange,
  unlockParts,
  updateAnnotations,
} from "../core/index.js"
import { Engine } from "../engine/engine.js"
import { setFilletRadius } from "../core/rules-edit.js"
import { RULES_PATH } from "../engine/rules/load.js"
import { LayoutBody } from "./layout-schema.js"
import { LiveProject, type DesignBuilder } from "./live.js"

export interface StudioOptions {
  root: string
  /** 0 picks a free port. */
  port?: number
  /** Folder with the built browser app; defaults to dist/app. */
  staticDir?: string
  /** Open event streams allowed at once. */
  maxStreams?: number
  /** Builds the designs the viewers draw; defaults to an Engine, which the Studio stops when it closes. */
  builder?: DesignBuilder
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
const point = z.object({ x: z.number().finite(), y: z.number().finite() })
/** A drawing prop: `points` takes a point list (the core checks which key may), every other prop a literal. */
const drawingProps = z.record(z.string().max(64), z.union([literal, z.array(point).max(1000)]))
/** setProps also takes a point (a moved label's offset) and null (removes the prop); the core checks which key may. */
const setPropValues = z.record(z.string().max(64), z.union([literal, point, z.null()]))
const EditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setProps"), part: z.string(), props: setPropValues }),
  z.object({ kind: z.literal("removePart"), part: z.string() }),
  z.object({
    kind: z.literal("addTrace"),
    from: z.string(),
    to: z.string(),
    props: props.optional(),
    schematicRouteHints: z
      .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
      .max(200)
      .optional(),
    page: z.string().max(64).optional(),
  }),
  z.object({ kind: z.literal("removeTrace"), from: z.string(), to: z.string() }),
  z.object({
    kind: z.literal("setTraceHints"),
    from: z.string(),
    to: z.string(),
    schematicRouteHints: z
      .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
      .max(200),
  }),
  z.object({ kind: z.literal("addDrawing"), tag: z.string().max(64), name: z.string().max(64).optional(), props: drawingProps, page: z.string().max(64).optional() }),
  z.object({ kind: z.literal("removeDrawing"), id: z.string().max(200) }),
  z.object({ kind: z.literal("setDrawingProps"), id: z.string().max(200), props: drawingProps }),
  z.object({ kind: z.literal("movePartToPage"), part: z.string(), page: z.string().max(64) }),
  z.object({ kind: z.literal("addPage"), name: z.string().max(64) }),
  z.object({ kind: z.literal("renamePage"), from: z.string().max(64), to: z.string().max(64) }),
  z.object({ kind: z.literal("removePage"), name: z.string().max(64) }),
  z.object({ kind: z.literal("renamePort"), from: z.string().max(64), to: z.string().max(64) }),
  z.object({ kind: z.literal("setSheetSize"), width: z.number().finite().nullable().optional(), height: z.number().finite().nullable().optional() }),
  z.object({ kind: z.literal("setConnections"), part: z.string(), connections: z.record(z.string().max(64), z.string().max(64)) }),
])
const Bodies = {
  // "Keep these positions" writes every auto-placed part in one request.
  edit: z.object({ file, summary: z.string().min(1).max(200), edits: z.array(EditSchema).min(1).max(500) }),
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
  redo: z.object({ id: z.string().optional() }),
  build: z.object({ file }),
  place: z.object({ file, part: z.string().min(1).max(64), name: z.string().max(40).optional(), props: props.optional(), page: z.string().max(64).optional() }),
  verify: z.object({ id: z.string().min(1).max(64), by: z.string().min(1).max(100), against: z.string().min(1).max(300), confirm: z.string() }),
  // The Design rules panel: a radius in mm, or null for the default.
  rules: z.object({ filletRadius: z.number().nullable(), file: z.string().optional() }),
  // Edit → Make sub-sheet: `preview` answers what it would do and writes nothing.
  makeSheet: z.object({
    file,
    name: z.string().min(1).max(64),
    parts: z.array(z.string().max(64)).max(500),
    rename: z.boolean().optional(),
    instance: z.string().max(64).optional(),
    preview: z.boolean().optional(),
  }),
}

/**
 * The circuit a history entry's file builds: itself, or the circuit beside a layout file. rules.yaml builds none
 * itself: the watcher builds every circuit again when an engine file changes.
 */
const builtFrom = (file: string): string | undefined => (file === RULES_PATH ? undefined : isLayoutFile(file) ? circuitPathFor(file) : file)

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
  const building = builderFor(options.builder)
  const live = new LiveProject(root, building.builder)
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

    /** Builds the circuit a history entry's file belongs to, when there is one. */
    const rebuild = (file: string) => {
      const circuit = builtFrom(file)
      if (circuit !== undefined) live.requestBuild(circuit)
    }
    /** The live design when it is current for the circuit file, else a fresh build. */
    const designOf = async (circuit: string) => (await live.currentDesign(circuit)) ?? (await building.builder.build(root, circuit))

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
      case "GET /api/sheets":
        return send(res, await listSheets(root))
      case "GET /api/project":
        return send(res, { name: basename(root) })
      case "GET /api/circuit": {
        const { model, annotations, violations, file: name } = await loadCircuit(root, query("file"))
        return send(res, { file: name, model, annotations, violations })
      }
      // Builds name the file without parsing it: a file with a syntax error still has a (failed) build.
      case "GET /api/build":
        return send(res, live.getBuild((await resolveCircuit(root, query("file"))).file))
      case "GET /api/history":
        return send(res, await listHistory(root, Number(url.searchParams.get("limit") ?? 50) || 50))
      case "POST /api/build": {
        const body = Bodies.build.parse(await readJson(req))
        live.requestBuild((await resolveCircuit(root, body.file)).file)
        return send(res, { status: "building" }, 202)
      }
      case "POST /api/edit": {
        const body = Bodies.edit.parse(await readJson(req))
        const result = await editCircuit(root, body.file, body.edits, { author: "human", summary: body.summary })
        // After the write and before the build it asks for: a build with a larger start mark read this change.
        const writeMark = live.nextMark()
        live.requestBuild(result.entry.file)
        return send(res, { entryId: result.entry.id, violations: result.violations, writeMark })
      }
      // The new sheet file rides on the circuit file's entry, so the build that follows reads both.
      case "POST /api/make-sheet": {
        const { file: name, preview, ...request } = Bodies.makeSheet.parse(await readJson(req))
        if (preview) return send(res, await previewSubSheet(root, name, request))
        const result = await makeSubSheet(root, name, request, { author: "human", engine: { build: (_root, circuit) => designOf(circuit) } })
        const writeMark = live.nextMark()
        live.requestBuild(result.entry.file)
        return send(res, { entryId: result.entry.id, preview: result.preview, writeMark })
      }
      // Copper goes to the layout file beside the circuit; the built design tells which tracks start on locked parts.
      case "POST /api/layout": {
        const body = LayoutBody.parse(await readJson(req))
        const result = await applyLayoutEdits(root, body.file, body.edits, { author: "human", summary: body.summary, design: designOf, ...(body.sheet ? { sheet: body.sheet } : {}) })
        const writeMark = live.nextMark()
        live.requestBuild(circuitPathFor(result.file))
        return send(res, { entryId: result.entry.id, created: result.created, writeMark })
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
      case "POST /api/rules": {
        const body = Bodies.rules.parse(await readJson(req))
        const entry = await setFilletRadius(root, body.filletRadius ?? undefined, { author: "human" })
        // The write's mark, as an edit's: a build that started after it read the new radius. The open circuit is built now
        // (the watcher builds every circuit again when rules.yaml changes, but later), so the mark is met soon.
        const writeMark = live.nextMark()
        if (body.file) live.requestBuild((await loadCircuit(root, body.file)).file)
        return send(res, { entryId: entry.id, summary: entry.summary, writeMark })
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
        live.requestBuild(result.entry.file)
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
        return send(res, await buildBom(root, circuit, { design: await designOf(circuit) }))
      }
      case "POST /api/package": {
        const circuit = (await loadCircuit(root, Bodies.build.parse(await readJson(req)).file)).file
        return send(res, await exportPackage(root, circuit, { design: await designOf(circuit) }))
      }
      // Undo and redo write the file too: their write mark, as an edit's, lets the keys wait for the build that read them.
      case "POST /api/undo": {
        const body = Bodies.undo.parse(await readJson(req))
        const entry = await undoChange(root, { author: "human", design: designOf, ...(body.id ? { id: body.id } : {}) })
        const writeMark = live.nextMark()
        rebuild(entry.file)
        return send(res, { entryId: entry.id, summary: entry.summary, writeMark })
      }
      case "POST /api/redo": {
        const body = Bodies.redo.parse(await readJson(req))
        const entry = await redoChange(root, { author: "human", design: designOf, ...(body.id ? { id: body.id } : {}) })
        const writeMark = live.nextMark()
        rebuild(entry.file)
        return send(res, { entryId: entry.id, summary: entry.summary, writeMark })
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
  }).catch(async (error: unknown) => {
    await building.stop()
    throw error
  })
  const address = server.address()
  port = typeof address === "object" && address ? address.port : 0
  live.start()

  return {
    url: `http://127.0.0.1:${port}`,
    token,
    openUrl: `http://127.0.0.1:${port}/#token=${token}`,
    close: async () => {
      live.stop()
      await building.stop()
      for (const stream of streams) stream.end()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    },
  }
}

/** The given builder, or a new engine that the Studio owns and so stops when it closes. */
function builderFor(given: DesignBuilder | undefined): { builder: DesignBuilder; stop(): Promise<void> } {
  if (given) return { builder: given, stop: async () => undefined }
  const engine = new Engine()
  return { builder: engine, stop: () => engine.stop() }
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
