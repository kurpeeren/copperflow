// Makes build-resources/icon.ico from the site's icon (site/public/favicon.svg): one PNG image per size Windows asks
// for, in one .ico file. Run it again only when the icon changes; the .ico is kept in the repository.
// usage: node scripts/icon.mjs (from desktop/, after `npm ci` in the repository root, which brings @napi-rs/canvas)
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")
// The canvas package is optional in the root; CANVAS_FROM names another install that has it.
const { createCanvas, loadImage } = createRequire(process.env.CANVAS_FROM ?? join(root, "package.json"))("@napi-rs/canvas")
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICO_HEADER = 6
const ICO_ENTRY = 16

const svg = readFileSync(join(root, "site", "public", "favicon.svg"))
const image = await loadImage(svg)
const pngs = SIZES.map((size) => {
  const canvas = createCanvas(size, size)
  canvas.getContext("2d").drawImage(image, 0, 0, size, size)
  return canvas.toBuffer("image/png")
})

const header = Buffer.alloc(ICO_HEADER)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(SIZES.length, 4)
let offset = ICO_HEADER + ICO_ENTRY * SIZES.length
const entries = SIZES.map((size, i) => {
  const entry = Buffer.alloc(ICO_ENTRY)
  // A width or height of 256 is written as 0.
  entry.writeUInt8(size === 256 ? 0 : size, 0)
  entry.writeUInt8(size === 256 ? 0 : size, 1)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(pngs[i].length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  return entry
})
const out = join(here, "..", "build-resources", "icon.ico")
writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]))
writeFileSync(join(here, "..", "build-resources", "icon.png"), pngs[pngs.length - 1])
console.log(`Wrote ${out}: ${SIZES.join(", ")} px`)
