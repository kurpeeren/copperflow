// Zip archives as streams, so neither an upload nor a download holds a whole project in memory. Reading checks the
// archive on disk with the same rules as zip.ts (names, kinds, sizes, ratio) before anything is written, then inflates
// entry by entry, asynchronously, never past the entry's declared size, checking its CRC. Writing deflates each file as
// it is read and records its CRC and sizes in a data descriptor after it.
import { createReadStream, createWriteStream } from "node:fs"
import { open, stat } from "node:fs/promises"
import { Readable, Transform, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createDeflateRaw, createInflateRaw } from "node:zlib"
import { checkedFiles, locateDirectory, parseDirectory, TAIL_BYTES, ZipRefusal, type Central } from "./zip.js"

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const DESCRIPTOR_SIGNATURE = 0x08074b50
const LOCAL_SIZE = 30
const CENTRAL_SIZE = 46
const END_SIZE = 22
const DEFLATED = 8
const VERSION = 20
const UTF8_NAMES = 0x0800
const HAS_DESCRIPTOR = 0x0008
const UNIX_HOST = 3
const S_IFREG = 0o100000
const MAX_ZIP_OFFSET = 0xfffffffe

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** Continues a CRC-32 over more data; start from 0. */
export function crc32Update(crc: number, data: Uint8Array): number {
  let c = (crc ^ 0xffffffff) >>> 0
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipOnDisk {
  path: string
  files: Central[]
}

async function readAt(path: string, start: number, length: number): Promise<Buffer> {
  const handle = await open(path, "r")
  try {
    const buf = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buf, 0, length, start)
    return buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/** Checks an archive on disk without inflating anything; the files to extract, or a ZipRefusal. */
export async function checkZipFile(path: string, maxUnpacked: number): Promise<ZipOnDisk> {
  const size = (await stat(path)).size
  if (size < END_SIZE) throw new ZipRefusal("The file is not a zip archive.")
  const tailStart = Math.max(0, size - TAIL_BYTES)
  const where = locateDirectory(await readAt(path, tailStart, size - tailStart), tailStart)
  const directory = await readAt(path, where.start, where.size)
  if (directory.length !== where.size) throw new ZipRefusal("The archive is damaged.")
  const entries = parseDirectory(directory, where.count)
  if (entries.length !== where.count) throw new ZipRefusal("The archive is damaged.")
  return { path, files: checkedFiles(entries, size, maxUnpacked) }
}

/** Counts and checksums what passes; fails once more than `limit` bytes came through. */
function counter(limit: number, onDone: (size: number, crc: number) => void): Transform {
  let size = 0
  let crc = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, next) {
      size += chunk.length
      if (size > limit) return next(new ZipRefusal("The archive is damaged."))
      crc = crc32Update(crc, chunk)
      next(null, chunk)
    },
    flush(next) {
      onDone(size, crc)
      next()
    },
  })
}

/** Inflates one checked entry into `destination` (created, never overwritten), checking its size and CRC. */
export async function extractEntry(zip: ZipOnDisk, entry: Central, destination: string): Promise<void> {
  const local = await readAt(zip.path, entry.offset, LOCAL_SIZE)
  if (local.length < LOCAL_SIZE || local.readUInt32LE(0) !== LOCAL_SIGNATURE) throw new ZipRefusal("The archive is damaged.")
  const start = entry.offset + LOCAL_SIZE + local.readUInt16LE(26) + local.readUInt16LE(28)
  let result: { size: number; crc: number } | undefined
  const stages: (Readable | Writable | Transform)[] = [entry.compressed === 0 ? Readable.from([]) : createReadStream(zip.path, { start, end: start + entry.compressed - 1 })]
  if (entry.method === DEFLATED && entry.compressed > 0) stages.push(createInflateRaw())
  stages.push(counter(entry.size, (size, crc) => (result = { size, crc })))
  stages.push(createWriteStream(destination, { flags: "wx", mode: 0o600 }))
  try {
    await pipeline(stages as [Readable, ...Writable[]])
  } catch (error) {
    if (error instanceof ZipRefusal) throw error
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw error
    throw new ZipRefusal("The archive is damaged.")
  }
  if (!result || result.size !== entry.size || result.crc !== entry.crc) throw new ZipRefusal("The archive is damaged.")
}

function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getUTCFullYear(), 1980)
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

/** Writes an archive to `out`, one file at a time, each deflated as it is read from disk. */
export class StreamZipWriter {
  private offset = 0
  private readonly central: Buffer[] = []
  private count = 0

  constructor(private readonly out: Writable) {}

  /** Writes to `out`, waiting for it to drain; fails at once when it is gone, and leaves no listener behind. */
  private async write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length
    if (this.offset > MAX_ZIP_OFFSET) throw new Error("The project is too large for a zip archive")
    const out = this.out
    if (out.destroyed || out.writableEnded) throw new Error("The download was closed")
    if (out.write(chunk)) return
    await new Promise<void>((done, fail) => {
      const finish = (error?: Error) => {
        out.off("drain", drained)
        out.off("close", closed)
        out.off("error", failed)
        if (error) fail(error)
        else done()
      }
      const drained = () => finish()
      const closed = () => finish(new Error("The download was closed"))
      const failed = (error: Error) => finish(error)
      out.on("drain", drained)
      out.on("close", closed)
      out.on("error", failed)
    })
  }

  /** Adds the bytes of `source` (a file at a path, or an open stream) as `name`. */
  async addFile(name: string, source: string | Readable, modified: Date): Promise<void> {
    const nameBytes = Buffer.from(name, "utf8")
    const when = dosDateTime(modified)
    const offset = this.offset
    const local = Buffer.alloc(LOCAL_SIZE)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(UTF8_NAMES | HAS_DESCRIPTOR, 6)
    local.writeUInt16LE(DEFLATED, 8)
    local.writeUInt16LE(when.time, 10)
    local.writeUInt16LE(when.day, 12)
    local.writeUInt16LE(nameBytes.length, 26)
    await this.write(Buffer.concat([local, nameBytes]))
    let size = 0
    let crc = 0
    let compressed = 0
    // read → count and checksum → deflate → this archive; an error on any stage (the file removed, the client gone)
    // rejects here and destroys the others.
    const measure = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        size += chunk.length
        crc = crc32Update(crc, chunk)
        next(null, chunk)
      },
    })
    const writer = this
    const sink = new Writable({
      write(chunk: Buffer, _encoding, next) {
        compressed += chunk.length
        writer.write(chunk).then(() => next(), next)
      },
    })
    await pipeline(typeof source === "string" ? createReadStream(source) : source, measure, createDeflateRaw({ level: 6 }), sink)
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0)
    descriptor.writeUInt32LE(crc, 4)
    descriptor.writeUInt32LE(compressed, 8)
    descriptor.writeUInt32LE(size, 12)
    await this.write(descriptor)
    const central = Buffer.alloc(CENTRAL_SIZE)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    central.writeUInt16LE((UNIX_HOST << 8) | VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(UTF8_NAMES | HAS_DESCRIPTOR, 8)
    central.writeUInt16LE(DEFLATED, 10)
    central.writeUInt16LE(when.time, 12)
    central.writeUInt16LE(when.day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(((S_IFREG | 0o644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    this.central.push(central, nameBytes)
    this.count += 1
    if (this.count >= 0xffff) throw new Error("The project has too many files for a zip archive")
  }

  async finish(): Promise<void> {
    const directory = Buffer.concat(this.central)
    const end = Buffer.alloc(END_SIZE)
    end.writeUInt32LE(END_SIGNATURE, 0)
    end.writeUInt16LE(this.count, 8)
    end.writeUInt16LE(this.count, 10)
    end.writeUInt32LE(directory.length, 12)
    end.writeUInt32LE(this.offset, 16)
    await this.write(Buffer.concat([directory, end]))
  }
}
