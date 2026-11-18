// A picture as a PNG without the canvas package: eight bits a channel with alpha, each row unfiltered, the whole
// deflated by Node's zlib. For the pictures inside a model file, which a design can be written as on a machine where
// the optional canvas package is not installed.
import { deflateSync } from "node:zlib"

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** One chunk: its length, its four-letter kind, its bytes, and the checksum of the kind and the bytes. */
function chunk(kind: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(kind), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
  return out
}

/** The picture's RGBA pixels as a PNG file's bytes. */
export function pngBytes(image: { rgba: Uint8ClampedArray; width: number; height: number }): Uint8Array {
  const { rgba, width, height } = image
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  // Eight bits a channel, colour with alpha, the only compression and filter methods, not interlaced.
  header.set([8, 6, 0, 0, 0], 8)
  const row = width * 4
  const raw = new Uint8Array((row + 1) * height)
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1)
  const parts = [Uint8Array.from(SIGNATURE), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  parts.reduce((offset, part) => (out.set(part, offset), offset + part.length), 0)
  return out
}
