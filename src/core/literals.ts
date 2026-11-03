import type { Node } from "@babel/types"
import type { Literal } from "./types.js"

const PROP_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED = new Set(["name", "key", "__proto__", "constructor", "prototype"])

/** Reads a literal from a JSX attribute value node; undefined means "not a literal". */
export function readLiteral(value: Node | null | undefined): Literal | undefined {
  if (value == null) return true
  if (value.type === "StringLiteral") return value.value
  if (value.type !== "JSXExpressionContainer") return undefined
  const expr = value.expression
  switch (expr.type) {
    case "NumericLiteral":
      return expr.value
    case "StringLiteral":
      return expr.value
    case "BooleanLiteral":
      return expr.value
    case "UnaryExpression":
      if (expr.operator === "-" && expr.argument.type === "NumericLiteral") return -expr.argument.value
      return undefined
    case "TemplateLiteral":
      if (expr.expressions.length === 0 && expr.quasis.length === 1) return expr.quasis[0]?.value.cooked ?? undefined
      return undefined
    default:
      return undefined
  }
}

/** Formats a literal as a JSX attribute value: `"5.1k"`, `{-4}`, `{true}`. */
export function formatLiteral(value: Literal): string {
  if (typeof value === "string") {
    // JSX decodes &entities; in plain attributes, so strings with & go in braces too.
    return /["\n\r{}&]/.test(value) ? `{${JSON.stringify(value)}}` : `"${value}"`
  }
  return `{${String(value)}}`
}

/** Throws when a prop name or value cannot be written as a literal attribute. */
export function validateProp(name: string, value: unknown): asserts value is Literal {
  if (!PROP_NAME.test(name)) throw new TypeError(`"${name}" is not a valid prop name`)
  if (RESERVED.has(name)) throw new TypeError(`"${name}" cannot be changed with setProps`)
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
  if (!["string", "number", "boolean"].includes(typeof value)) {
    throw new TypeError(`${name} must be a string, number or boolean`)
  }
}
