// The text of an ISO 10303-21 exchange file's DATA section, entity by entity: each entity gets the next number, and
// the few kinds written everywhere (points, directions, placements, lines) have a helper. Shared by the solids
// (step.ts) and the parts written as their faces (step-faces.ts).

/** A real as the format wants it: always with a decimal point, rounded to 1e-10 mm so float noise does not show. */
export function stepReal(value: number): string {
  const rounded = Math.round(value * 1e10) / 1e10
  const clean = Object.is(rounded, -0) || rounded === 0 ? 0 : rounded
  const text = String(clean)
  if (/e/i.test(text)) {
    const [mantissa = "0", exponent = "0"] = text.toUpperCase().split("E")
    return `${mantissa.includes(".") ? mantissa : `${mantissa}.`}E${exponent.startsWith("-") ? exponent : `+${exponent.replace("+", "")}`}`
  }
  return text.includes(".") ? text : `${text}.`
}

/** A string as the format quotes it. */
export const quoted = (text: string) => `'${text.replace(/'/g, "''")}'`

export type Vec = readonly [number, number, number]

/** A list of references as the format writes it: "(#1,#2)". */
export const refList = (ids: readonly number[]) => `(${ids.map((id) => `#${id}`).join(",")})`

export class Entities {
  private readonly lines: string[] = []
  private readonly once = new Map<string, number>()
  add(text: string): number {
    this.lines.push(text)
    return this.lines.length
  }
  text(): string {
    return this.lines.map((line, i) => `#${i + 1}=${line};\n`).join("")
  }
  point(p: Vec): number {
    return this.add(`CARTESIAN_POINT('',(${p.map(stepReal).join(",")}))`)
  }
  direction(d: Vec): number {
    return this.add(`DIRECTION('',(${d.map(stepReal).join(",")}))`)
  }
  /** An entity written once per file and referred to by every user of the same text. */
  shared(text: string): number {
    const known = this.once.get(text)
    if (known !== undefined) return known
    const id = this.add(text)
    this.once.set(text, id)
    return id
  }
  /** A direction written once per file. */
  sharedDirection(d: Vec): number {
    return this.shared(`DIRECTION('',(${d.map(stepReal).join(",")}))`)
  }
  placement(at: Vec, axis: Vec, ref: Vec): number {
    return this.add(`AXIS2_PLACEMENT_3D('',#${this.point(at)},#${this.direction(axis)},#${this.direction(ref)})`)
  }
  line(at: Vec, along: Vec): number {
    return this.add(`LINE('',#${this.point(at)},#${this.add(`VECTOR('',#${this.direction(along)},1.)`)})`)
  }
}
