// Whether a sheet from a library is plain: data written as a sheet, nothing that runs. A circuit file is code, so a
// sheet that came from somebody else enters a project only when its syntax tree holds nothing but imports of library
// parts, one parameterless function returning JSX, built-in tags or those parts, and literal values.
import { parse } from "@babel/parser"
import type { Expression, ImportDeclaration, JSXAttribute, JSXElement, JSXSpreadAttribute, Node, ObjectExpression, Statement } from "@babel/types"
import { PART_ID } from "./pin-types.js"

/** The only import a plain sheet may have: `./parts/<id>/<Component>`, as save_module writes it. */
const PART_SOURCE = /^\.\/parts\/([^/]+)\/([A-Za-z_][A-Za-z0-9_]*)$/
const BUILT_IN_TAG = /^[a-z][A-Za-z0-9]*$/

export interface PlainPart {
  source: string
  id: string
  component: string
}

export interface PlainSheet {
  /** The name of the default-exported function. */
  name: string
  parts: PlainPart[]
}

class NotPlain extends Error {}

const WHAT: Record<string, string> = {
  CallExpression: "a call",
  OptionalCallExpression: "a call",
  NewExpression: "a call",
  TaggedTemplateExpression: "a call",
  MemberExpression: "a member access",
  OptionalMemberExpression: "a member access",
  SpreadElement: "a spread",
  JSXSpreadAttribute: "a spread",
  JSXSpreadChild: "a spread",
  TemplateLiteral: "a template",
}

function refuse(node: Node, what: string): never {
  throw new NotPlain(`line ${node.loc?.start.line ?? "?"}: ${what}`)
}

const describe = (node: Node): string => (node.type === "Identifier" ? `a reference to ${node.name}` : (WHAT[node.type] ?? `a ${node.type}`))

/** A literal value: a string, a number (negative too), a boolean, or an object or array made only of those. */
function literal(node: Expression | Node): void {
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
      return
    case "UnaryExpression":
      if (node.operator === "-" && node.argument.type === "NumericLiteral") return
      return refuse(node, node.operator === "-" ? "a negation of something other than a number" : `the operator ${node.operator}`)
    case "ArrayExpression":
      for (const item of node.elements) {
        if (item === null) refuse(node, "an array with a hole")
        literal(item)
      }
      return
    case "ObjectExpression":
      return object(node)
    default:
      return refuse(node, describe(node))
  }
}

function object(node: ObjectExpression): void {
  for (const property of node.properties) {
    if (property.type !== "ObjectProperty") refuse(property, describe(property))
    if (property.computed) refuse(property, "a computed key")
    if (property.shorthand) refuse(property, describe(property.value))
    if (!["Identifier", "StringLiteral", "NumericLiteral"].includes(property.key.type)) refuse(property.key, describe(property.key))
    literal(property.value)
  }
}

function attribute(node: JSXAttribute | JSXSpreadAttribute): void {
  if (node.type === "JSXSpreadAttribute") refuse(node, "a spread")
  if (node.name.type !== "JSXIdentifier") refuse(node, "a namespaced attribute")
  const value = node.value
  if (value === null || value === undefined || value.type === "StringLiteral") return
  if (value.type !== "JSXExpressionContainer") refuse(value, describe(value))
  if (value.expression.type === "JSXEmptyExpression") refuse(value, "an empty attribute value")
  literal(value.expression)
}

function element(node: JSXElement, parts: ReadonlySet<string>): void {
  const name = node.openingElement.name
  if (name.type !== "JSXIdentifier") {
    const shown = name.type === "JSXMemberExpression" ? `${(name.object as { name?: string }).name ?? "?"}.${name.property.name}` : `${name.namespace.name}:${name.name.name}`
    refuse(node, `the tag ${shown}`)
  }
  if (!BUILT_IN_TAG.test(name.name) && !parts.has(name.name)) refuse(node, `the tag ${name.name}, which is not an imported part`)
  for (const item of node.openingElement.attributes) attribute(item)
  for (const child of node.children) {
    if (child.type === "JSXText") continue
    if (child.type === "JSXElement") element(child, parts)
    else if (child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression") continue
    else if (child.type === "JSXExpressionContainer") refuse(child.expression, describe(child.expression))
    else refuse(child, describe(child))
  }
}

function partImport(node: ImportDeclaration): PlainPart {
  const source = node.source.value
  const found = PART_SOURCE.exec(source)
  const only = node.specifiers.length === 1 ? node.specifiers[0] : undefined
  const named =
    only?.type === "ImportSpecifier" && only.imported.type === "Identifier" && only.imported.name === only.local.name ? only.local.name : undefined
  const plain = found && PART_ID.test(found[1] as string) && !(found[1] as string).includes("..") && named === found[2]
  if (!plain || node.importKind === "type" || (node.attributes?.length ?? 0) > 0) refuse(node, `an import of "${source}"; only "./parts/<id>/<Component>" { <Component> } is allowed`)
  return { source, id: found[1] as string, component: found[2] as string }
}

function sheetFunction(statement: Statement, parts: ReadonlySet<string>): string {
  if (statement.type !== "ExportDefaultDeclaration") refuse(statement, "a statement other than the default export")
  const declaration = statement.declaration
  if (declaration.type !== "FunctionDeclaration" || !declaration.id) refuse(declaration, "a default export that is not a function")
  if (declaration.async || declaration.generator) refuse(declaration, "an async or generator function")
  if (declaration.params.length > 0) refuse(declaration, "a parameter")
  if (declaration.typeParameters || declaration.returnType) refuse(declaration, "a type on the function")
  const body = declaration.body
  if (body.directives.length > 0) refuse(body, "a directive")
  const [first, ...rest] = body.body
  if (first === undefined) refuse(body, "an empty function")
  if (first.type !== "ReturnStatement") refuse(first, "a statement before the return")
  if (rest[0] !== undefined) refuse(rest[0], "a statement after the return")
  if (!first.argument || first.argument.type !== "JSXElement") refuse(first.argument ?? first, "a return of something other than JSX")
  element(first.argument, parts)
  return declaration.id.name
}

/** The sheet's name and the parts it imports, or an error naming the first thing that is not plain and its line. */
export function checkPlainSheet(text: string): PlainSheet {
  let program
  try {
    program = parse(text, { sourceType: "module", plugins: ["typescript", "jsx"] }).program
  } catch (error) {
    throw new Error(`the sheet does not parse: ${(error as Error).message.split("\n")[0]}`)
  }
  try {
    if (program.directives.length > 0) refuse(program, "a directive")
    const parts: PlainPart[] = []
    let index = 0
    for (; index < program.body.length && program.body[index]?.type === "ImportDeclaration"; index++) parts.push(partImport(program.body[index] as ImportDeclaration))
    const main = program.body[index]
    if (main === undefined) refuse(program, "no default-exported function")
    const name = sheetFunction(main, new Set(parts.map((part) => part.component)))
    const extra = program.body[index + 1]
    if (extra !== undefined) refuse(extra, "a statement after the default export")
    return { name, parts }
  } catch (error) {
    if (error instanceof NotPlain) throw new Error(`the sheet is not plain: ${error.message}`)
    throw error
  }
}
