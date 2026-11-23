// The pixel size of a PNG, JPEG or SVG image, read from its header (an SVG's from its width and height, else its
// viewBox), without decoding it. A reference image's points are pixels of it, so the size is kept in its record.

export type ImageKind = "png" | "jpeg" | "svg"

export interface ImageSize {
  kind: ImageKind
  width: number
  height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
/** The JPEG frame markers that carry the size: SOF0 to SOF15 but DHT (C4), JPG (C8) and DAC (CC). */
const FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function pngSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { kind: "png", width: view.getUint32(16), height: view.getUint32(20) }
}

function jpegSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined
    const marker = bytes[at + 1] as number
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (FRAME_MARKERS.has(marker)) return { kind: "jpeg", height: view.getUint16(at + 5), width: view.getUint16(at + 7) }
    at += 2 + view.getUint16(at + 2)
  }
  return undefined
}

/** A length in an SVG's own units; units other than px (or none) are not a pixel size. */
const length = (value: string | undefined) => (value !== undefined && /^\s*[\d.]+\s*(px)?\s*$/.test(value) ? Number.parseFloat(value) : undefined)

function svgSize(bytes: Uint8Array): ImageSize | undefined {
  const text = new TextDecoder().decode(bytes.subarray(0, 4096))
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (tag === undefined) return undefined
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1]
  const [width, height] = [length(attribute("width")), length(attribute("height"))]
  if (width && height) return { kind: "svg", width, height }
  const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number)
  if (box?.length === 4 && (box[2] as number) > 0 && (box[3] as number) > 0) return { kind: "svg", width: box[2] as number, height: box[3] as number }
  return undefined
}

/** The image's kind and size, or undefined when it is not a PNG, JPEG or SVG whose size can be read. */
export function imageSize(bytes: Uint8Array): ImageSize | undefined {
  const size = pngSize(bytes) ?? jpegSize(bytes) ?? svgSize(bytes)
  return size && size.width > 0 && size.height > 0 ? size : undefined
}
