// A small zip writer: each file stored or deflated (whichever is smaller) with Node's built-in zlib, in the order given,
// every entry dated with the one date passed in, so the same files give the same bytes. No ZIP64: the fabrication
// files are far below its 4 GB limit. copperflow's own code, written from PKWARE's APPNOTE.
import { deflateRawSync } from "node:zlib"

export interface ZipInput {
  /** The entry's name inside the archive, "/" between folders. */
  name: string
  text: string
}

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
/** Version 2.0: deflate. */
const VERSION = 20
/** General-purpose flag bit 11: the names are UTF-8. */
const UTF8_NAMES = 0x0800
const STORED = 0
const DEFLATED = 8
const LOCAL_SIZE = 30
const CENTRAL_SIZE = 46
const END_SIZE = 22
/**
 * The deflate level, fixed so a zlib whose default changes still writes the same archive: zlib's normal level, which
 * is what the general-purpose flags' compression bits (left 0, "normal") say.
 */
export const DEFLATE_LEVEL = 6
/** The first year a DOS date can hold. */
const DOS_EPOCH = 1980

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** The CRC-32 of the zip format (the IEEE polynomial, reflected). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** The DOS time and date fields of `date` read in UTC: two-second steps, years from 1980. */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(date.getUTCFullYear(), DOS_EPOCH)
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)
  const day = ((year - DOS_EPOCH) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  return { time, day }
}

interface Entry {
  name: Buffer
  method: number
  crc: number
  size: number
  body: Buffer
  offset: number
}

/** The fields local and central headers share, from "version needed" to the name's length. */
function shared(header: Buffer, at: number, entry: Entry, when: { time: number; day: number }): void {
  header.writeUInt16LE(VERSION, at)
  header.writeUInt16LE(UTF8_NAMES, at + 2)
  header.writeUInt16LE(entry.method, at + 4)
  header.writeUInt16LE(when.time, at + 6)
  header.writeUInt16LE(when.day, at + 8)
  header.writeUInt32LE(entry.crc, at + 10)
  header.writeUInt32LE(entry.body.length, at + 14)
  header.writeUInt32LE(entry.size, at + 18)
  header.writeUInt16LE(entry.name.length, at + 22)
}

/** The archive of the files, in the order given, each dated `modified`. */
export function zipFiles(files: readonly ZipInput[], modified: Date): Uint8Array {
  const when = dosDateTime(modified)
  const parts: Buffer[] = []
  const entries: Entry[] = []
  let offset = 0
  for (const file of files) {
    const data = Buffer.from(file.text, "utf8")
    const deflated = deflateRawSync(data, { level: DEFLATE_LEVEL })
    const smaller = deflated.length < data.length
    const entry: Entry = { name: Buffer.from(file.name, "utf8"), method: smaller ? DEFLATED : STORED, crc: crc32(data), size: data.length, body: smaller ? deflated : data, offset }
    const local = Buffer.alloc(LOCAL_SIZE)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    shared(local, 4, entry, when)
    parts.push(local, entry.name, entry.body)
    offset += LOCAL_SIZE + entry.name.length + entry.body.length
    entries.push(entry)
  }
  const directoryStart = offset
  for (const entry of entries) {
    const central = Buffer.alloc(CENTRAL_SIZE)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    central.writeUInt16LE(VERSION, 4)
    shared(central, 6, entry, when)
    central.writeUInt32LE(entry.offset, 42)
    parts.push(central, entry.name)
    offset += CENTRAL_SIZE + entry.name.length
  }
  const end = Buffer.alloc(END_SIZE)
  end.writeUInt32LE(END_SIGNATURE, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(offset - directoryStart, 12)
  end.writeUInt32LE(directoryStart, 16)
  parts.push(end)
  return new Uint8Array(Buffer.concat(parts))
}
