// `copperflow graphic <file> <drawing.svg|dxf> --layer … [--at x,y] [--width mm | --scale n] [--rotation deg] [--fill]
// [--name …] [--net …]`: a drawing in the project placed on the board as one change, as import_graphic does.
import { formatGraphicImport, importGraphic, type ImportGraphicOptions } from "./core/graphic-import.js"
import type { DesignSource } from "./core/design-source.js"

export const GRAPHIC_USAGE =
  "Usage: copperflow graphic <file> <drawing.svg|dxf> --layer top-silkscreen|bottom-silkscreen|top-mask|bottom-mask|top|bottom|inner1|inner2 [--at x,y] [--width mm | --scale n] [--rotation deg] [--fill] [--name text] [--net name]"

/** The value after `name`, and the arguments without the two. */
function take(args: readonly string[], name: string): [string | undefined, string[]] {
  const index = args.indexOf(name)
  if (index === -1) return [undefined, [...args]]
  const value = args[index + 1]
  if (value === undefined || value === "") throw new Error(`Missing ${name} value. ${GRAPHIC_USAGE}`)
  return [value, [...args.slice(0, index), ...args.slice(index + 2)]]
}

function number(text: string | undefined, name: string): number | undefined {
  if (text === undefined) return undefined
  const value = Number(text)
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number (got "${text}")`)
  return value
}

function position(text: string | undefined): { x?: number; y?: number } {
  if (text === undefined) return {}
  const [x, y] = text.split(",").map(Number)
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`--at must look like 10,5 (got "${text}")`)
  return { x, y }
}

/** Reads the command's arguments into the circuit, the drawing and how it is placed. */
export function graphicRequest(args: readonly string[]): { file: string; options: ImportGraphicOptions } {
  const [layer, a1] = take(args, "--layer")
  const [at, a2] = take(a1, "--at")
  const [width, a3] = take(a2, "--width")
  const [scale, a4] = take(a3, "--scale")
  const [rotation, a5] = take(a4, "--rotation")
  const [name, a6a] = take(a5, "--name")
  const [net, a6] = take(a6a, "--net")
  const fill = a6.includes("--fill")
  const [file, source, ...extra] = a6.filter((arg) => arg !== "--fill")
  if (file === undefined || source === undefined || layer === undefined) throw new Error(`Missing ${file === undefined ? "the circuit file" : source === undefined ? "the drawing" : "--layer"}. ${GRAPHIC_USAGE}`)
  if (extra.length > 0) throw new Error(`Unknown argument ${extra[0]}. ${GRAPHIC_USAGE}`)
  const options: ImportGraphicOptions = {
    source,
    layer,
    ...position(at),
    width: number(width, "--width"),
    scale: number(scale, "--scale"),
    rotation: number(rotation, "--rotation"),
    ...(fill ? { fill: true } : {}),
    ...(name === undefined ? {} : { name }),
    ...(net === undefined ? {} : { net }),
  }
  return { file, options }
}

export async function graphicCommand(root: string, args: readonly string[], engine: DesignSource | undefined): Promise<string> {
  const { file, options } = graphicRequest(args)
  const result = await importGraphic(root, file, options, { author: "human", ...(engine ? { engine } : {}) })
  return formatGraphicImport(result).join("\n")
}
