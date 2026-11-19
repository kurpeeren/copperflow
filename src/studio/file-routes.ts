// The Files tab's routes: the project folder as a flat list, and one file's content for the read-only preview. The
// server checks Host, Origin and the key before these run. A path is taken only when it stays inside the project, on
// disk too (a link that leads out is refused), and only the kinds the preview shows are served.
import { open, realpath, stat } from "node:fs/promises"
import { isAbsolute, relative, sep } from "node:path"
import { isInside } from "../core/file-writes.js"
import { resolveInRoot } from "../core/workspace.js"
import { imageType, previewKind } from "./file-kinds.js"
import { isSkippedPath, listProjectFiles, type FileListing } from "./file-list.js"
import { HttpError } from "./http-error.js"
import { projectRoot } from "./studio-note.js"

/** A text file larger than this comes cut to its first MAX_TEXT_BYTES. */
export const MAX_TEXT_BYTES = 512 * 1024
/** An image larger than this is refused. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
/** What an image may do once loaded: nothing but draw, with its own inline styles (an SVG's script never runs). */
const IMAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline'"

export interface TextContent {
  kind: "text"
  text: string
  truncated: boolean
  /** The whole file's size in bytes. */
  size: number
}

/** A route's answer: data the server sends as JSON, or bytes with their own headers. */
export type FileAnswer = { json: FileListing | TextContent } | { bytes: Buffer; headers: Record<string, string> }

/** The answer to a Files route, or undefined when the route is not one of them. */
export async function fileRoute(route: string, params: URLSearchParams, root: string): Promise<FileAnswer | undefined> {
  if (route === "GET /api/files") return { json: await listProjectFiles(root) }
  if (route !== "GET /api/file") return undefined
  const path = params.get("path")
  if (!path) throw new HttpError(400, "Missing path")
  return readProjectFile(root, path)
}

/** The file's content as the preview shows it: text up to MAX_TEXT_BYTES, an image's bytes, else 415. */
export async function readProjectFile(root: string, path: string): Promise<FileAnswer> {
  const target = await resolveListed(root, path)
  const type = imageType(path)
  if (type !== undefined) return { bytes: await readImage(target, path), headers: imageHeaders(type) }
  if (previewKind(path) === "text") return { json: await readText(target) }
  throw new HttpError(415, `${path} is not a kind the preview shows`)
}

function imageHeaders(type: string): Record<string, string> {
  return { "content-type": type, "content-security-policy": IMAGE_POLICY, "x-content-type-options": "nosniff", "cache-control": "no-store" }
}

/**
 * The real path of a file the Files tab lists: relative, no "..", not under a folder the list leaves out, and on disk
 * inside the project once every link is followed.
 */
async function resolveListed(root: string, path: string): Promise<string> {
  const parts = path.split(/[\\/]/)
  if (path.includes("\0") || isAbsolute(path) || /^[a-z]:/i.test(path) || parts.includes("..")) throw new HttpError(400, `${path} is not a path inside the project`)
  if (isSkippedPath(parts.join("/"))) throw new HttpError(404, `${path} is not in the project's file list`)
  const real = projectRoot(root)
  let target: string
  try {
    target = await realpath(resolveInRoot(real, path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, `${path} is not there`)
    throw error
  }
  if (!isInside(real, target)) throw new HttpError(400, `${path} leads out of the project`)
  // A link inside the project may still lead into a folder the list leaves out, such as .git.
  if (isSkippedPath(relative(real, target).split(sep).join("/"))) throw new HttpError(404, `${path} is not in the project's file list`)
  if (!(await stat(target)).isFile()) throw new HttpError(404, `${path} is not a file`)
  return target
}

async function readImage(target: string, path: string): Promise<Buffer> {
  const { size } = await stat(target)
  if (size > MAX_IMAGE_BYTES) throw new HttpError(413, `${path} is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
  return readStart(target, size)
}

async function readText(target: string): Promise<TextContent> {
  const { size } = await stat(target)
  // One byte past the limit, to see whether the cut falls inside a character.
  const bytes = await readStart(target, Math.min(size, MAX_TEXT_BYTES + 1))
  const truncated = bytes.length > MAX_TEXT_BYTES
  return { kind: "text", text: (truncated ? bytes.subarray(0, characterEnd(bytes, MAX_TEXT_BYTES)) : bytes).toString("utf8"), truncated, size }
}

/** The first `length` bytes of the file, read once (the file may be growing while the agent writes it). */
async function readStart(target: string, length: number): Promise<Buffer> {
  const handle = await open(target, "r")
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const CONTINUATION_MASK = 0xc0
const CONTINUATION_BITS = 0x80

/**
 * Where a UTF-8 text cut at `limit` ends without splitting a character: from the cut back over continuation bytes
 * (10xxxxxx) to the start of the character the cut falls in. `bytes` holds at least one byte past the limit.
 */
function characterEnd(bytes: Buffer, limit: number): number {
  let end = limit
  while (end > 0 && ((bytes[end] ?? 0) & CONTINUATION_MASK) === CONTINUATION_BITS) end -= 1
  return end
}
