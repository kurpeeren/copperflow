// Zip archives for project download and upload, written from PKWARE's APPNOTE like src/engine/fab/zip.ts (whose
// CRC-32 it reuses). The writer streams one file at a time. The reader trusts nothing in the archive: every name is
// checked before anything is written, sizes and ratios are bounded before anything is inflated, and each entry must
// inflate to exactly its declared size and CRC.
import { inflateRawSync, deflateRawSync } from "node:zlib"
import { crc32 } from "../engine/fab/zip.js"

export const MAX_ENTRIES = 2000
export const MAX_UNPACKED_BYTES = 200 * 1024 * 1024
export const MAX_RATIO = 100

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const LOCAL_SIZE = 30
const CENTRAL_SIZE = 46
const END_SIZE = 22
const MAX_COMMENT = 0xffff
const STORED = 0
const DEFLATED = 8
const UTF8_NAMES = 0x0800
const ENCRYPTED = 0x0001
const VERSION = 20
const MAX_NAME_BYTES = 512
const UNIX_HOST = 3
const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000
const DOS_DIRECTORY = 0x10
/** Windows device names, refused as any segment with or without an extension. */
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i

/** Refused archive, with a message a person can act on. */
export class ZipRefusal extends Error {}

export interface ZipEntry {
  /** The checked relative path, "/" between folders. */
  name: string
  data: Buffer
}

/** Why `name` may not be written into a project, or undefined when it may. */
export function badEntryName(name: string): string | undefined {
  if (name === "") return "an empty name"
  if (name.includes("\\")) return "a backslash"
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return "an absolute path"
  // Control characters, and the characters Windows refuses in names (":" also opens alternate data streams).
  if (/[\u0000-\u001f\u007f<>:"|?*]/.test(name)) return "a character a file name cannot hold"
  const segments = name.split("/")
  for (const segment of segments) {
    if (segment === "..") return "a .. segment"
    if (segment === "" || segment === ".") return "an empty or . segment"
    if (DEVICE.test(segment)) return "a device name"
    if (/[ .]$/.test(segment)) return "a name ending in a dot or space"
  }
  return undefined
}

function unpackedTotal(declared: readonly { size: number }[]): number {
  return declared.reduce((sum, entry) => sum + entry.size, 0)
}

interface Central {
  name: string
  flags: number
  method: number
  crc: number
  compressed: number
  size: number
  offset: number
  isDirectory: boolean
}

function findEnd(buf: Buffer): number {
  const earliest = Math.max(0, buf.length - END_SIZE - MAX_COMMENT)
  for (let at = buf.length - END_SIZE; at >= earliest; at -= 1) if (buf.readUInt32LE(at) === END_SIGNATURE) return at
  throw new ZipRefusal("The file is not a zip archive.")
}

function kindOf(versionMadeBy: number, external: number, name: string): "file" | "directory" | "other" {
  const directoryName = name.endsWith("/")
  if (versionMadeBy >> 8 === UNIX_HOST) {
    const mode = external >>> 16
    const type = mode & S_IFMT
    if (type === S_IFREG || (type === 0 && !directoryName)) return directoryName ? "other" : "file"
    if (type === S_IFDIR || (type === 0 && directoryName)) return directoryName ? "directory" : "other"
    return "other"
  }
  return directoryName || (external & DOS_DIRECTORY) !== 0 ? (directoryName ? "directory" : "other") : "file"
}

function readCentral(buf: Buffer): Central[] {
  const end = findEnd(buf)
  if (buf.readUInt16LE(end + 4) !== 0 || buf.readUInt16LE(end + 6) !== 0) throw new ZipRefusal("Archives split over several files are not supported.")
  const count = buf.readUInt16LE(end + 10)
  const size = buf.readUInt32LE(end + 12)
  const start = buf.readUInt32LE(end + 16)
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new ZipRefusal("ZIP64 archives are not supported.")
  if (count > MAX_ENTRIES) throw new ZipRefusal(`The archive has more than ${MAX_ENTRIES} entries.`)
  if (start + size > end) throw new ZipRefusal("The archive is damaged.")
  const entries: Central[] = []
  let at = start
  while (at < start + size) {
    if (entries.length >= MAX_ENTRIES) throw new ZipRefusal(`The archive has more than ${MAX_ENTRIES} entries.`)
    if (at + CENTRAL_SIZE > end || buf.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new ZipRefusal("The archive is damaged.")
    const nameLength = buf.readUInt16LE(at + 28)
    const next = at + CENTRAL_SIZE + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
    if (next > start + size) throw new ZipRefusal("The archive is damaged.")
    if (nameLength > MAX_NAME_BYTES) throw new ZipRefusal("An entry's name is too long.")
    const raw = buf.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength)
    const name = new TextDecoder("utf-8", { fatal: false }).decode(raw)
    const flags = buf.readUInt16LE(at + 8)
    if (!(flags & UTF8_NAMES) && raw.some((byte) => byte > 0x7f)) throw new ZipRefusal("An entry's name is not UTF-8.")
    const kind = kindOf(buf.readUInt16LE(at + 4), buf.readUInt32LE(at + 38), name)
    if (kind === "other") throw new ZipRefusal(`The archive holds a link or special file (${JSON.stringify(name.slice(0, 80))}).`)
    const checkedName = kind === "directory" ? name.slice(0, -1) : name
    const bad = badEntryName(checkedName)
    if (bad) throw new ZipRefusal(`An entry's name has ${bad} (${JSON.stringify(name.slice(0, 80))}).`)
    entries.push({
      name: checkedName,
      flags,
      method: buf.readUInt16LE(at + 10),
      crc: buf.readUInt32LE(at + 16),
      compressed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
      isDirectory: kind === "directory",
    })
    at = next
  }
  if (entries.length !== count) throw new ZipRefusal("The archive is damaged.")
  return entries
}

function checkNamesDistinct(entries: readonly Central[]): void {
  const seen = new Map<string, boolean>()
  for (const entry of entries) {
    // Case-insensitive, so the same archive unpacks alike on every file system.
    const key = entry.name.toLowerCase()
    const known = seen.get(key)
    if (known !== undefined && !(known && entry.isDirectory)) throw new ZipRefusal(`The archive holds ${JSON.stringify(entry.name.slice(0, 80))} twice.`)
    seen.set(key, entry.isDirectory)
  }
  for (const entry of entries) {
    const parts = entry.name.toLowerCase().split("/")
    for (let i = 1; i < parts.length; i += 1) {
      if (seen.get(parts.slice(0, i).join("/")) === false) throw new ZipRefusal(`${JSON.stringify(entry.name.slice(0, 80))} lies inside a file.`)
    }
  }
}

/**
 * The files of an archive, checked. Refuses absolute paths, `..` segments, backslashes, links and special files,
 * device names, more than `MAX_ENTRIES` entries, more than `maxUnpacked` bytes unpacked and an unpacked size above
 * `MAX_RATIO` times the archive's.
 */
export function readZipArchive(bytes: Buffer, maxUnpacked = MAX_UNPACKED_BYTES): ZipEntry[] {
  const entries = readCentral(bytes)
  checkNamesDistinct(entries)
  const files = entries.filter((entry) => !entry.isDirectory)
  for (const entry of files) {
    if (entry.flags & ENCRYPTED) throw new ZipRefusal("Encrypted archives are not supported.")
    if (entry.method !== STORED && entry.method !== DEFLATED) throw new ZipRefusal("The archive uses a compression method other than deflate.")
    if (entry.size === 0xffffffff || entry.compressed === 0xffffffff) throw new ZipRefusal("ZIP64 archives are not supported.")
  }
  const total = unpackedTotal(files)
  if (total > maxUnpacked) throw new ZipRefusal(`The archive unpacks to more than ${Math.floor(maxUnpacked / (1024 * 1024))} MB.`)
  if (total > MAX_RATIO * Math.max(bytes.length, 1)) throw new ZipRefusal(`The archive unpacks to more than ${MAX_RATIO} times its size.`)
  return files.map((entry) => ({ name: entry.name, data: inflateEntry(bytes, entry) }))
}

function inflateEntry(buf: Buffer, entry: Central): Buffer {
  const at = entry.offset
  if (at + LOCAL_SIZE > buf.length || buf.readUInt32LE(at) !== LOCAL_SIGNATURE) throw new ZipRefusal("The archive is damaged.")
  const start = at + LOCAL_SIZE + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28)
  if (start + entry.compressed > buf.length) throw new ZipRefusal("The archive is damaged.")
  const raw = buf.subarray(start, start + entry.compressed)
  let data: Buffer
  try {
    // Never inflate past the declared size: a lying header cannot make this allocate more.
    data = entry.method === STORED ? Buffer.from(raw) : inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) })
  } catch {
    throw new ZipRefusal("The archive is damaged.")
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) throw new ZipRefusal("The archive is damaged.")
  return data
}

/** DOS date and time of `date` in UTC. */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getUTCFullYear(), 1980)
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  }
}

/** Writes an archive one entry at a time to `write`; returns the bytes written. */
export class ZipWriter {
  private offset = 0
  private readonly central: Buffer[] = []
  private count = 0

  constructor(private readonly write: (chunk: Buffer) => Promise<void>) {}

  async add(name: string, data: Buffer, modified: Date): Promise<void> {
    const nameBytes = Buffer.from(name, "utf8")
    const deflated = deflateRawSync(data, { level: 6 })
    const smaller = deflated.length < data.length
    const body = smaller ? deflated : data
    if (this.offset + LOCAL_SIZE + nameBytes.length + body.length > 0xfffffffe || this.count >= 0xfffe) throw new Error("The project is too large for a zip archive")
    const when = dosDateTime(modified)
    const fields = (header: Buffer, at: number) => {
      header.writeUInt16LE(VERSION, at)
      header.writeUInt16LE(UTF8_NAMES, at + 2)
      header.writeUInt16LE(smaller ? DEFLATED : STORED, at + 4)
      header.writeUInt16LE(when.time, at + 6)
      header.writeUInt16LE(when.day, at + 8)
      header.writeUInt32LE(crc32(data), at + 10)
      header.writeUInt32LE(body.length, at + 14)
      header.writeUInt32LE(data.length, at + 18)
      header.writeUInt16LE(nameBytes.length, at + 22)
    }
    const local = Buffer.alloc(LOCAL_SIZE)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    fields(local, 4)
    const central = Buffer.alloc(CENTRAL_SIZE)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    // Made by Unix, so the external attributes below read as a regular file with mode 644.
    central.writeUInt16LE((UNIX_HOST << 8) | VERSION, 4)
    fields(central, 6)
    central.writeUInt32LE(((S_IFREG | 0o644) << 16) >>> 0, 38)
    central.writeUInt32LE(this.offset, 42)
    this.central.push(central, nameBytes)
    this.count += 1
    await this.write(Buffer.concat([local, nameBytes, body]))
    this.offset += LOCAL_SIZE + nameBytes.length + body.length
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
