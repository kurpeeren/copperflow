// The upload form read as it arrives: short text fields into memory, the one file part into a sink (a file on disk),
// never holding more than a few kilobytes plus one chunk. More than `maxBytes` in all is refused (413) as soon as it
// is passed.
import type { Writable } from "node:stream"
import { HubError } from "./http.js"

const MAX_PARTS = 8
const MAX_FIELD_BYTES = 4096
const MAX_HEADER_BYTES = 1024

function nameOf(disposition: string, key: "name" | "filename"): string | undefined {
  return new RegExp(`;\\s*${key}="([^"\\r\\n]*)"`, "i").exec(disposition)?.[1]
}

interface Part {
  name: string
  file?: Sink
  text: Buffer[]
  textSize: number
}

/** The upload could not be stored (disk full, folder not writable): the hub answers it and keeps serving. */
export class StorageError extends HubError {
  constructor(cause: unknown) {
    const full = (cause as NodeJS.ErrnoException | undefined)?.code === "ENOSPC"
    super(full ? 507 : 500, full ? "The server has no room for this upload right now. Try again later." : "The upload could not be stored. Try again later.")
  }
}

/**
 * The file sink with one error listener from the moment it is made: a write or open error is kept and turns every
 * later write into a StorageError, so it can never reach the process as an unhandled 'error'.
 */
class Sink {
  error: unknown
  private waiting: ((error?: unknown) => void) | undefined

  constructor(readonly file: Writable) {
    file.on("error", (error) => {
      this.error = error
      this.waiting?.(error)
    })
  }

  private wait(event: "drain" | "finish"): Promise<void> {
    return new Promise((done, fail) => {
      const settle = (error?: unknown) => {
        this.waiting = undefined
        this.file.off(event, ok)
        if (error) fail(new StorageError(error))
        else done()
      }
      const ok = () => settle()
      this.waiting = settle
      this.file.once(event, ok)
    })
  }

  async write(data: Buffer): Promise<void> {
    if (this.error) throw new StorageError(this.error)
    if (!this.file.write(data)) await this.wait("drain")
  }

  async end(): Promise<void> {
    if (this.error) throw new StorageError(this.error)
    const finished = this.wait("finish")
    this.file.end()
    await finished
  }
}

/** Parses the stream; `fileSink` is called once, for the one file part. */
export async function streamMultipart(source: AsyncIterable<Buffer>, boundary: string, maxBytes: number, fileSink: () => Writable): Promise<{ fields: Map<string, string>; fileField?: string }> {
  const bad = () => new HubError(400, "The upload form is not valid.")
  // The first delimiter has no line break before it; adding one lets every delimiter be found the same way.
  const delimiter = Buffer.from(`\r\n--${boundary}`)
  let pending = Buffer.from("\r\n")
  let total = 0
  let parts = 0
  let part: Part | undefined
  let fileField: string | undefined
  let state: "delimiter" | "after" | "headers" | "done" = "delimiter"
  const fields = new Map<string, string>()

  const feed = async (data: Buffer): Promise<void> => {
    if (!part) {
      // Before the first part only the line break we added may stand.
      if (data.some((byte) => byte !== 0x0d && byte !== 0x0a)) throw bad()
      return
    }
    if (part.file) return part.file.write(data)
    part.textSize += data.length
    if (part.textSize > MAX_FIELD_BYTES) throw bad()
    part.text.push(Buffer.from(data))
  }

  const endPart = async (data: Buffer): Promise<void> => {
    await feed(data)
    if (!part) return
    if (part.file) await part.file.end()
    else fields.set(part.name, Buffer.concat(part.text).toString("utf8"))
    part = undefined
  }

  const startPart = (): boolean => {
    const end = pending.indexOf("\r\n\r\n")
    if (end < 0) {
      if (pending.length > MAX_HEADER_BYTES) throw bad()
      return false
    }
    const disposition = pending.subarray(0, end).toString("utf8").split("\r\n").find((line) => /^content-disposition:/i.test(line)) ?? ""
    pending = pending.subarray(end + 4)
    if (!/^content-disposition:\s*form-data\s*;/i.test(disposition)) throw bad()
    const name = nameOf(disposition, "name")
    if (!name || fields.has(name)) throw bad()
    if (nameOf(disposition, "filename") !== undefined) {
      if (fileField !== undefined) throw bad()
      fileField = name
      part = { name, file: new Sink(fileSink()), text: [], textSize: 0 }
    } else part = { name, text: [], textSize: 0 }
    state = "delimiter"
    return true
  }

  const step = async (): Promise<boolean> => {
    if (state === "delimiter") {
      const at = pending.indexOf(delimiter)
      if (at < 0) {
        // Everything but a possible start of the delimiter can go on.
        if (pending.length > delimiter.length) {
          await feed(pending.subarray(0, pending.length - delimiter.length))
          pending = Buffer.from(pending.subarray(pending.length - delimiter.length))
        }
        return false
      }
      await endPart(pending.subarray(0, at))
      pending = Buffer.from(pending.subarray(at + delimiter.length))
      state = "after"
      return true
    }
    if (state === "after") {
      if (pending.length < 2) return false
      const two = pending.subarray(0, 2).toString()
      if (two === "--") {
        state = "done"
        return false
      }
      if (two !== "\r\n" || ++parts > MAX_PARTS) throw bad()
      pending = pending.subarray(2)
      state = "headers"
      return true
    }
    if (state === "headers") return startPart()
    return false
  }

  try {
    for await (const chunk of source) {
      total += chunk.length
      if (total > maxBytes) throw new HubError(413, "The archive is too large.")
      if ((state as string) === "done") continue
      pending = Buffer.concat([pending, chunk])
      while (await step()) {
        // Parse as far as the bytes so far allow.
      }
    }
  } finally {
    if (part?.file) part.file.file.destroy()
  }
  if ((state as string) !== "done") throw bad()
  return fileField !== undefined ? { fields, fileField } : { fields }
}
