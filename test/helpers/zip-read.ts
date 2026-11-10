// Reads a zip archive back through its central directory, inflating each entry with Node's zlib and checking it
// against the CRC-32 Node computes, so the tests do not trust the writer's own checksum.
import { crc32, inflateRawSync } from "node:zlib"

export interface ReadZipEntry {
  name: string
  method: number
  flags: number
  /** The DOS date and time fields, decoded (no time zone; two-second steps). */
  modified: { year: number; month: number; day: number; hours: number; minutes: number; seconds: number }
  data: Buffer
}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const STORED = 0
const DEFLATED = 8

export function readZip(bytes: Uint8Array): ReadZipEntry[] {
  const buf = Buffer.from(bytes)
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0 || buf.readUInt32LE(end) !== EOCD) throw new Error("no end of central directory")
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const entries: ReadZipEntry[] = []
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== CENTRAL) throw new Error(`entry ${i}: not a central directory header`)
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const time = buf.readUInt16LE(at + 12)
    const date = buf.readUInt16LE(at + 14)
    const crc = buf.readUInt32LE(at + 16)
    const compressed = buf.readUInt32LE(at + 20)
    const size = buf.readUInt32LE(at + 24)
    const nameLength = buf.readUInt16LE(at + 28)
    const extra = buf.readUInt16LE(at + 30)
    const comment = buf.readUInt16LE(at + 32)
    const offset = buf.readUInt32LE(at + 42)
    const name = buf.toString("utf8", at + 46, at + 46 + nameLength)
    if (buf.readUInt32LE(offset) !== LOCAL) throw new Error(`${name}: no local header`)
    if (buf.toString("utf8", offset + 30, offset + 30 + buf.readUInt16LE(offset + 26)) !== name) throw new Error(`${name}: local name differs`)
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28)
    const raw = buf.subarray(start, start + compressed)
    if (method !== STORED && method !== DEFLATED) throw new Error(`${name}: method ${method}`)
    const data = method === STORED ? Buffer.from(raw) : inflateRawSync(raw)
    if (data.length !== size) throw new Error(`${name}: size ${data.length}, header says ${size}`)
    if (crc32(data) !== crc) throw new Error(`${name}: CRC-32 differs`)
    entries.push({
      name,
      method,
      flags,
      modified: { year: 1980 + (date >> 9), month: (date >> 5) & 0xf, day: date & 0x1f, hours: time >> 11, minutes: (time >> 5) & 0x3f, seconds: (time & 0x1f) * 2 },
      data,
    })
    at += 46 + nameLength + extra + comment
  }
  return entries
}
