// A small XML reader for SVG files: elements, attributes and nesting, nothing more. Text content is kept only as a
// flag, comments, CDATA and processing instructions are passed over. Only the five predefined entities and numeric
// character references are decoded; a document type that declares entities is refused (an entity that expands into
// more entities can grow a small file into gigabytes), and so is any other named entity.
import { GraphicError } from "./shapes.js"

export interface XmlElement {
  /** The local name, without a namespace prefix ("svg:path" is "path"); prefixed names keep their prefix. */
  name: string
  attributes: ReadonlyMap<string, string>
  children: XmlElement[]
}

/** The deepest nesting of elements read. */
export const MAX_XML_DEPTH = 256

const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }
const NAME = /[A-Za-z_:][\w:.-]*/y
const ATTRIBUTE = /\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y
const TAG_END = /\s*(\/?)>/y

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][\w.-]*);?/g, (whole, body: string) => {
    if (!whole.endsWith(";")) throw new GraphicError("The file has a bare '&' that is not a character reference")
    if (body.startsWith("#")) {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) throw new GraphicError("The file has a character reference that names no character")
      return String.fromCodePoint(code)
    }
    const known = PREDEFINED[body]
    if (known === undefined) throw new GraphicError(`The file uses the entity "&${body};", and entities are not expanded`)
    return known
  })
}

const localName = (name: string) => (name.startsWith("svg:") ? name.slice(4) : name)

function skipTo(text: string, at: number, end: string, what: string): number {
  const found = text.indexOf(end, at)
  if (found === -1) throw new GraphicError(`The file ends inside ${what}`)
  return found + end.length
}

/** Passes over a <!DOCTYPE ...>, internal subset included, refusing entity declarations. */
function skipDoctype(text: string, at: number): number {
  const open = text.indexOf("[", at)
  const close = text.indexOf(">", at)
  if (close === -1) throw new GraphicError("The file ends inside its <!DOCTYPE>")
  const end = open !== -1 && open < close ? skipTo(text, skipTo(text, open, "]", "its <!DOCTYPE>"), ">", "its <!DOCTYPE>") : close + 1
  if (/<!ENTITY/i.test(text.slice(at, end))) throw new GraphicError("The file declares entities in its <!DOCTYPE>; such files are refused, since entities can expand without bound")
  return end
}

function readTag(text: string, at: number): { element: XmlElement; end: number; selfClosing: boolean } {
  NAME.lastIndex = at + 1
  const name = NAME.exec(text)?.[0]
  if (!name) throw new GraphicError("The file has a '<' that does not start a tag")
  const attributes = new Map<string, string>()
  let cursor = at + 1 + name.length
  for (;;) {
    ATTRIBUTE.lastIndex = cursor
    const found = ATTRIBUTE.exec(text)
    if (!found) break
    attributes.set(found[1] as string, decode((found[2] ?? found[3]) as string))
    cursor = ATTRIBUTE.lastIndex
  }
  TAG_END.lastIndex = cursor
  const end = TAG_END.exec(text)
  if (!end) throw new GraphicError(`The tag <${name}> is not well formed`)
  return { element: { name: localName(name), attributes, children: [] }, end: TAG_END.lastIndex, selfClosing: end[1] === "/" }
}

/** What follows a '<' that is not a start tag: the index after it, or undefined when it is a start tag. */
function skipMarkup(text: string, at: number): number | undefined {
  if (text.startsWith("<!--", at)) return skipTo(text, at + 4, "-->", "a comment")
  if (text.startsWith("<![CDATA[", at)) return skipTo(text, at + 9, "]]>", "a CDATA section")
  if (text.startsWith("<?", at)) return skipTo(text, at + 2, "?>", "a processing instruction")
  if (text.startsWith("<!DOCTYPE", at)) return skipDoctype(text, at)
  if (text.startsWith("<!", at)) throw new GraphicError("The file has markup this reader does not know")
  return undefined
}

function closeTag(text: string, at: number, stack: XmlElement[]): number {
  const end = skipTo(text, at, ">", "a closing tag")
  const name = localName(text.slice(at + 2, end - 1).trim())
  const open = stack.pop()
  if (!open || open.name !== name) throw new GraphicError(`The closing tag </${name}> does not match ${open ? `<${open.name}>` : "any open tag"}`)
  return end
}

/** The document's root element. */
export function parseXml(text: string): XmlElement {
  const stack: XmlElement[] = []
  let root: XmlElement | undefined
  let at = 0
  while (at < text.length) {
    const lt = text.indexOf("<", at)
    const textRun = text.slice(at, lt === -1 ? text.length : lt)
    if (textRun.includes("&")) decode(textRun)
    if (textRun.trim() !== "" && stack.length === 0) throw new GraphicError("The file has text outside its root element")
    if (lt === -1) break
    const skipped = skipMarkup(text, lt)
    if (skipped !== undefined) at = skipped
    else if (text.startsWith("</", lt)) at = closeTag(text, lt, stack)
    else {
      const { element, end, selfClosing } = readTag(text, lt)
      const parent = stack.at(-1)
      if (parent) parent.children.push(element)
      else if (root) throw new GraphicError("The file has more than one root element")
      else root = element
      if (!selfClosing) stack.push(element)
      if (stack.length > MAX_XML_DEPTH) throw new GraphicError(`The file nests elements more than ${MAX_XML_DEPTH} deep`)
      at = end
    }
  }
  if (stack.length > 0) throw new GraphicError(`The file ends before <${(stack.at(-1) as XmlElement).name}> is closed`)
  if (!root) throw new GraphicError("The file has no elements")
  return root
}
