// A built-in part's supplier part number as set_props writes it: "jlcpcb:C25804" becomes
// supplierPartNumbers={{ jlcpcb: ["C25804"] }}, the shape the engine reads and the BOM lists.
import type { Node } from "@babel/types"
import { EditError } from "./edit-error.js"

export const SUPPLIER_PROP = "supplierPartNumbers"

const SUPPLIER_VALUE = /^([A-Za-z][A-Za-z0-9_]*):(\S+)$/

/** `"jlcpcb:C25804"` as the attribute value `{{ jlcpcb: ["C25804"] }}`; anything else is refused. */
export function formatSupplierProp(value: unknown): string {
  const match = typeof value === "string" ? SUPPLIER_VALUE.exec(value.trim()) : null
  if (!match) throw new EditError("invalid", `${SUPPLIER_PROP} takes "<supplier>:<number>", e.g. "jlcpcb:C25804"`)
  return `{{ ${match[1]}: [${JSON.stringify(match[2])}] }}`
}

const isText = (node: Node | null): boolean => node?.type === "StringLiteral"

/** True for a literal `{{ supplier: ["C1"] }}` or `{{ supplier: "C1" }}`, which set_props may write over. */
export function isSupplierObject(value: Node | null | undefined): boolean {
  if (value?.type !== "JSXExpressionContainer" || value.expression.type !== "ObjectExpression") return false
  return value.expression.properties.every(
    (property) =>
      property.type === "ObjectProperty" &&
      !property.computed &&
      (property.key.type === "Identifier" || property.key.type === "StringLiteral") &&
      (isText(property.value) || (property.value.type === "ArrayExpression" && property.value.elements.every(isText))),
  )
}
