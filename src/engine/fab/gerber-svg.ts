// A Gerber layer (RS-274X / X2) as an SVG picture, for a reference image under the PCB: flashes, draws (lines and
// arcs), regions, aperture macros, step and repeat, and clear polarity (masks). Pixels are a fixed size in mm, so the
// picture keeps the layer's own scale. What is not drawn is named. Pure; copperflow's own code, written from the
// Gerber format specification.

export interface GerberPicture {
  svg: string
  width: number
  height: number
  /** One pixel in mm. */
  pixel: number
  /** The layer's extent in its own mm (y up). */
  box: { minX: number; minY: number; maxX: number; maxY: number }
  /** What was read but not drawn, in words. */
  skipped: string[]
}

export class GerberError extends Error {}

interface XY {
  x: number
  y: number
}

/** A shape drawn in mm, y up: filled outlines (even-odd) or a stroked path of one width. */
type Shape = { fill: XY[][] } | { stroke: string; width: number; round: boolean; points: XY[] }

interface Aperture {
  template: string
  params: number[]
}

const INCH = 25.4
/** The sharpest the picture is drawn, in pixels per mm, and the largest it may be. */
const MAX_DENSITY = 20
const MAX_SIDE = 4000
const MARGIN_MM = 1
const ARC_STEPS = 48
/** The colour of what is drawn. */
const INK = "#f2f2f2"

/** The file split into its commands: each extended command (%…%) as its blocks, each word command alone. */
function commands(text: string): { extended: boolean; blocks: string[] }[] {
  const out: { extended: boolean; blocks: string[] }[] = []
  let at = 0
  while (at < text.length) {
    const c = text[at] as string
    if (/\s/.test(c)) {
      at++
      continue
    }
    if (c === "%") {
      const end = text.indexOf("%", at + 1)
      if (end < 0) throw new GerberError("an extended command is not closed with %")
      const body = text.slice(at + 1, end).replace(/\s+/g, "")
      out.push({ extended: true, blocks: body.split("*").filter((b) => b !== "") })
      at = end + 1
      continue
    }
    const end = text.indexOf("*", at)
    if (end < 0) break
    out.push({ extended: false, blocks: [text.slice(at, end).replace(/\s+/g, "")] })
    at = end + 1
  }
  return out
}

/** Evaluates an aperture macro expression: numbers, $n, + - x / and brackets. */
function evaluate(expression: string, vars: ReadonlyMap<number, number>): number {
  const tokens = expression.match(/\$\d+|\d*\.?\d+|[-+xX/()]/g) ?? []
  let i = 0
  const peek = () => tokens[i]
  const primary = (): number => {
    const t = tokens[i++]
    if (t === "(") {
      const v = sum()
      i++
      return v
    }
    if (t === "-") return -primary()
    if (t === "+") return primary()
    if (t?.startsWith("$")) return vars.get(Number(t.slice(1))) ?? 0
    return Number(t ?? 0)
  }
  const product = (): number => {
    let v = primary()
    while (peek() === "x" || peek() === "X" || peek() === "/") v = tokens[i++] === "/" ? v / primary() : v * primary()
    return v
  }
  const sum = (): number => {
    let v = product()
    while (peek() === "+" || peek() === "-") v = tokens[i++] === "+" ? v + product() : v - product()
    return v
  }
  return sum()
}

const turn = (p: XY, degrees: number): XY => {
  const r = (degrees * Math.PI) / 180
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) }
}

const circle = (c: XY, radius: number, steps = ARC_STEPS): XY[] => Array.from({ length: steps }, (_, k) => ({ x: c.x + radius * Math.cos((2 * Math.PI * k) / steps), y: c.y + radius * Math.sin((2 * Math.PI * k) / steps) }))
const box = (w: number, h: number, c: XY = { x: 0, y: 0 }): XY[] => [
  { x: c.x - w / 2, y: c.y - h / 2 },
  { x: c.x + w / 2, y: c.y - h / 2 },
  { x: c.x + w / 2, y: c.y + h / 2 },
  { x: c.x - w / 2, y: c.y + h / 2 },
]

function obround(w: number, h: number): XY[] {
  const r = Math.min(w, h) / 2
  const [dx, dy] = [w / 2 - r, h / 2 - r]
  const half = (c: XY, from: number) => Array.from({ length: ARC_STEPS / 2 + 1 }, (_, k) => ({ x: c.x + r * Math.cos(from + (Math.PI * k) / (ARC_STEPS / 2)), y: c.y + r * Math.sin(from + (Math.PI * k) / (ARC_STEPS / 2)) }))
  return w >= h ? [...half({ x: dx, y: 0 }, -Math.PI / 2), ...half({ x: -dx, y: 0 }, Math.PI / 2)] : [...half({ x: 0, y: dy }, 0), ...half({ x: 0, y: -dy }, Math.PI)]
}

/** The macro's primitives as outlines around the flash point, in file units. */
function macroOutlines(body: readonly string[], params: readonly number[], skipped: Set<string>): XY[][] {
  const vars = new Map(params.map((v, i) => [i + 1, v]))
  const outlines: XY[][] = []
  for (const block of body) {
    const assign = /^\$(\d+)=(.+)$/.exec(block)
    if (assign) {
      vars.set(Number(assign[1]), evaluate(assign[2] as string, vars))
      continue
    }
    // A comment primitive: 0 and its words (the spaces are gone with the rest of the whitespace).
    if (/^0(\D|$)/.test(block)) continue
    const [code, ...rest] = block.split(",")
    const v = rest.map((e) => evaluate(e, vars))
    if (v[0] === 0 && code !== "7") {
      skipped.add("macro primitives with exposure off")
      continue
    }
    const at = (x: number | undefined, y: number | undefined) => ({ x: x ?? 0, y: y ?? 0 })
    if (code === "1") outlines.push(circle(turn(at(v[2], v[3]), v[4] ?? 0), (v[1] ?? 0) / 2))
    else if (code === "20") {
      const [a, b, w] = [at(v[2], v[3]), at(v[4], v[5]), v[1] ?? 0]
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const n = { x: (-(b.y - a.y) / len) * (w / 2), y: ((b.x - a.x) / len) * (w / 2) }
      outlines.push([{ x: a.x + n.x, y: a.y + n.y }, { x: b.x + n.x, y: b.y + n.y }, { x: b.x - n.x, y: b.y - n.y }, { x: a.x - n.x, y: a.y - n.y }].map((p) => turn(p, v[6] ?? 0)))
    } else if (code === "21") outlines.push(box(v[1] ?? 0, v[2] ?? 0, at(v[3], v[4])).map((p) => turn(p, v[5] ?? 0)))
    else if (code === "4") {
      const n = v[1] ?? 0
      outlines.push(Array.from({ length: n + 1 }, (_, k) => turn(at(v[2 + 2 * k], v[3 + 2 * k]), v[4 + 2 * n] ?? 0)))
    } else if (code === "5") {
      const [n, c, d, rot] = [v[1] ?? 3, at(v[2], v[3]), v[4] ?? 0, v[5] ?? 0]
      outlines.push(Array.from({ length: n }, (_, k) => turn({ x: c.x + (d / 2) * Math.cos((2 * Math.PI * k) / n), y: c.y + (d / 2) * Math.sin((2 * Math.PI * k) / n) }, rot)))
    } else if (code === "7") {
      const c = at(v[0], v[1])
      outlines.push(circle(c, (v[2] ?? 0) / 2), circle(c, (v[3] ?? 0) / 2))
    } else skipped.add(`aperture macro primitive ${code}`)
  }
  return outlines
}

/** A flash's outlines around the origin, in file units; an aperture's hole is an inner outline (even-odd). */
function flashOutlines(aperture: Aperture, macros: ReadonlyMap<string, string[]>, skipped: Set<string>): XY[][] {
  const [a = 0, b = 0, c = 0] = aperture.params
  const hole = (index: number) => ((aperture.params[index] ?? 0) > 0 ? [circle({ x: 0, y: 0 }, (aperture.params[index] as number) / 2)] : [])
  switch (aperture.template) {
    case "C":
      return [circle({ x: 0, y: 0 }, a / 2), ...hole(1)]
    case "R":
      return [box(a, b), ...hole(2)]
    case "O":
      return [obround(a, b), ...hole(2)]
    case "P":
      return [Array.from({ length: Math.max(3, Math.round(b)) }, (_, k) => turn({ x: (a / 2) * Math.cos((2 * Math.PI * k) / b), y: (a / 2) * Math.sin((2 * Math.PI * k) / b) }, c)), ...hole(3)]
    default: {
      const body = macros.get(aperture.template)
      if (body) return macroOutlines(body, aperture.params, skipped)
      skipped.add(`aperture ${aperture.template} (not defined)`)
      return []
    }
  }
}

/** The points of an arc from `from` to `to` about `centre`, turning clockwise or not; a full circle when they meet. */
function arcPoints(from: XY, to: XY, centre: XY, clockwise: boolean): XY[] {
  const r = Math.hypot(from.x - centre.x, from.y - centre.y)
  const a0 = Math.atan2(from.y - centre.y, from.x - centre.x)
  let a1 = Math.atan2(to.y - centre.y, to.x - centre.x)
  if (clockwise) {
    while (a1 >= a0) a1 -= 2 * Math.PI
  } else while (a1 <= a0) a1 += 2 * Math.PI
  const steps = Math.max(2, Math.ceil((Math.abs(a1 - a0) / (2 * Math.PI)) * ARC_STEPS))
  return Array.from({ length: steps }, (_, k) => ({ x: centre.x + r * Math.cos(a0 + ((a1 - a0) * (k + 1)) / steps), y: centre.y + r * Math.sin(a0 + ((a1 - a0) * (k + 1)) / steps) }))
}

/** The format statement's way of reading a coordinate without a point. */
interface Format {
  integers: number
  decimals: number
  trailing: boolean
}

function coordinate(text: string, format: Format, unit: number): number {
  if (text.includes(".")) return Number.parseFloat(text) * unit
  const sign = text.startsWith("-") ? -1 : 1
  let digits = text.replace(/^[+-]/, "")
  if (format.trailing) digits = digits.padEnd(format.integers + format.decimals, "0")
  return (sign * Number.parseInt(digits, 10) * unit) / 10 ** format.decimals
}

/** Reads the layer into shapes in mm, each with its polarity, in file order. */
function readShapes(text: string): { shapes: { clear: boolean; shape: Shape }[]; skipped: Set<string> } {
  const skipped = new Set<string>()
  const apertures = new Map<number, Aperture>()
  const macros = new Map<string, string[]>()
  const shapes: { clear: boolean; shape: Shape }[] = []
  let format: Format = { integers: 3, decimals: 6, trailing: false }
  let unit = 1
  let clear = false
  let current: Aperture | undefined
  let mode: "linear" | "cw" | "ccw" = "linear"
  let region: XY[][] | undefined
  let at: XY = { x: 0, y: 0 }
  let operation = "D02"
  let repeat: { x: number; y: number; i: number; j: number; from: number } | undefined
  const add = (shape: Shape) => shapes.push({ clear, shape })
  const closeRepeat = () => {
    if (!repeat) return
    const block = shapes.slice(repeat.from)
    for (let ix = 0; ix < repeat.x; ix++)
      for (let iy = 0; iy < repeat.y; iy++) {
        if (ix === 0 && iy === 0) continue
        const move = (p: XY) => ({ x: p.x + ix * repeat!.i, y: p.y + iy * repeat!.j })
        for (const one of block) shapes.push({ clear: one.clear, shape: "fill" in one.shape ? { fill: one.shape.fill.map((o) => o.map(move)) } : { ...one.shape, points: one.shape.points.map(move) } })
      }
    repeat = undefined
  }
  const extended = (blocks: string[]) => {
    const [first = "", ...rest] = blocks
    if (first.startsWith("FS")) {
      const m = /^FS([LT])?[AI]?X(\d)(\d)Y\d\d/.exec(first)
      if (!m) throw new GerberError(`the format statement ${first} cannot be read`)
      format = { trailing: m[1] === "T", integers: Number(m[2]), decimals: Number(m[3]) }
    } else if (first === "MOIN") unit = INCH
    else if (first === "MOMM") unit = 1
    else if (first === "LPC") clear = true
    else if (first === "LPD") clear = false
    else if (first.startsWith("AM")) macros.set(first.slice(2), rest)
    else if (first.startsWith("AD")) {
      const m = /^ADD(\d+)([^,]+)(?:,(.*))?$/.exec(first)
      if (m) apertures.set(Number(m[1]), { template: m[2] as string, params: (m[3] ?? "").split("X").filter((p) => p !== "").map(Number) })
    } else if (first.startsWith("SR")) {
      closeRepeat()
      const m = /^SRX(\d+)Y(\d+)I([-\d.]+)J([-\d.]+)/.exec(first)
      if (m && (Number(m[1]) > 1 || Number(m[2]) > 1)) repeat = { x: Number(m[1]), y: Number(m[2]), i: Number(m[3]) * unit, j: Number(m[4]) * unit, from: shapes.length }
    } else if (/^(LM|LR|LS)/.test(first)) skipped.add("aperture mirroring, turning and scaling (LM, LR, LS)")
    else if (first.startsWith("AB")) skipped.add("block apertures (AB)")
  }
  const operate = (word: string) => {
    if (word.startsWith("G04")) return
    for (const g of word.match(/G3[67]|G7[45]|G0?[1-3](?!\d)/g) ?? []) {
      const n = Number(g.slice(1))
      if (n === 1) mode = "linear"
      else if (n === 2) mode = "cw"
      else if (n === 3) mode = "ccw"
      else if (n === 36) region = []
      else if (n === 37) {
        if (region && region.length > 0) add({ fill: region.filter((c) => c.length > 2) })
        region = undefined
      }
    }
    if (/^G7[01]/.test(word)) unit = word.startsWith("G70") ? INCH : 1
    const select = /^(?:G54)?D(\d+)$/.exec(word)
    if (select && Number(select[1]) >= 10) {
      current = apertures.get(Number(select[1]))
      return
    }
    const value = (letter: string) => new RegExp(`${letter}([+-]?[\\d.]+)`).exec(word)?.[1]
    const [x, y, i, j] = ["X", "Y", "I", "J"].map(value)
    if (x === undefined && y === undefined && !/D0?[123]$/.test(word)) return
    const code = /D0?([123])$/.exec(word)?.[1]
    if (code !== undefined) operation = `D0${code}`
    const to = { x: x === undefined ? at.x : coordinate(x, format, unit), y: y === undefined ? at.y : coordinate(y, format, unit) }
    if (operation === "D02") {
      if (region) region.push([to])
    } else if (operation === "D01") {
      const path = mode === "linear" ? [to] : arcPoints(at, to, { x: at.x + (i ? coordinate(i, format, unit) : 0), y: at.y + (j ? coordinate(j, format, unit) : 0) }, mode === "cw")
      if (region) {
        if (region.length === 0) region.push([at])
        ;(region[region.length - 1] as XY[]).push(...path)
      } else if (current) {
        const round = current.template !== "R"
        add({ stroke: `D${current.template}`, width: ((current.params[0] ?? 0) * unit), round, points: [at, ...path] })
      }
    } else if (operation === "D03" && current) {
      add({ fill: flashOutlines(current, macros, skipped).map((o) => o.map((p) => ({ x: to.x + p.x * unit, y: to.y + p.y * unit }))) })
    }
    at = to
  }
  for (const command of commands(text)) {
    if (command.extended) extended(command.blocks)
    else if (!/^M0?[02]$/.test(command.blocks[0] as string)) operate(command.blocks[0] as string)
  }
  closeRepeat()
  return { shapes, skipped }
}

const fmt = (n: number) => String(Math.round(n * 1e4) / 1e4)
const svgPoint = (p: XY) => `${fmt(p.x)} ${fmt(-p.y)}`

function element(shape: Shape, colour: string): string {
  if ("fill" in shape) {
    const d = shape.fill.map((o) => `M${o.map(svgPoint).join("L")}Z`).join("")
    return `<path d="${d}" fill="${colour}" fill-rule="evenodd"/>`
  }
  const d = `M${shape.points.map(svgPoint).join("L")}`
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${fmt(shape.width)}" stroke-linecap="${shape.round ? "round" : "square"}" stroke-linejoin="round"/>`
}

function extent(shapes: readonly { shape: Shape }[]): GerberPicture["box"] | undefined {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { shape } of shapes) {
    const pad = "fill" in shape ? 0 : shape.width / 2
    for (const p of "fill" in shape ? shape.fill.flat() : shape.points) {
      minX = Math.min(minX, p.x - pad)
      minY = Math.min(minY, p.y - pad)
      maxX = Math.max(maxX, p.x + pad)
      maxY = Math.max(maxY, p.y + pad)
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined
}

/** Draws the Gerber layer as an SVG at a fixed pixel size; throws GerberError when it is not a Gerber file or draws nothing. */
export function gerberToSvg(text: string): GerberPicture {
  if (!/%FS/.test(text)) throw new GerberError("it is not a Gerber file: it has no format statement (%FS…%)")
  const { shapes, skipped } = readShapes(text)
  const found = extent(shapes.filter((s) => !s.clear))
  if (!found) throw new GerberError("the layer draws nothing")
  const span = Math.max(found.maxX - found.minX, found.maxY - found.minY) + 2 * MARGIN_MM
  const density = Math.min(MAX_DENSITY, MAX_SIDE / span)
  const width = Math.ceil((found.maxX - found.minX + 2 * MARGIN_MM) * density)
  const height = Math.ceil((found.maxY - found.minY + 2 * MARGIN_MM) * density)
  const [left, top] = [found.minX - MARGIN_MM, found.maxY + MARGIN_MM]
  const view = `${fmt(left)} ${fmt(-top)} ${fmt(width / density)} ${fmt(height / density)}`
  // Each run of clear shapes masks out everything drawn before it.
  let body = ""
  let masks = ""
  let maskCount = 0
  let index = 0
  while (index < shapes.length) {
    const run = shapes[index] as { clear: boolean }
    let end = index
    while (end < shapes.length && (shapes[end] as { clear: boolean }).clear === run.clear) end++
    const slice = shapes.slice(index, end)
    if (run.clear) {
      const id = `m${maskCount++}`
      masks += `<mask id="${id}" maskUnits="userSpaceOnUse" x="${fmt(left)}" y="${fmt(-top)}" width="${fmt(width / density)}" height="${fmt(height / density)}"><rect x="${fmt(left)}" y="${fmt(-top)}" width="${fmt(width / density)}" height="${fmt(height / density)}" fill="#fff"/>${slice.map((s) => element(s.shape, "#000")).join("")}</mask>`
      body = `<g mask="url(#${id})">${body}</g>`
    } else body += slice.map((s) => element(s.shape, INK)).join("")
    index = end
  }
  const defs = masks === "" ? "" : `<defs>${masks}</defs>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${view}">${defs}${body}</svg>\n`
  return { svg, width, height, pixel: 1 / density, box: found, skipped: [...skipped] }
}

/** Whether the file name is a Gerber layer's, by its extension. */
export const isGerberName = (name: string): boolean => /\.(gbr|ger|pho|art|gtl|gbl|gto|gbo|gts|gbs|gtp|gbp|gko|gm1|gml|g[1-9]|gp[1-9])$/i.test(name)
