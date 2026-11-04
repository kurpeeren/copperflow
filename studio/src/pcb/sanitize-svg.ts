const BLOCKED_ELEMENTS = "script, foreignObject, iframe, object, embed, audio, video, animate, set, animateTransform"

/**
 * Parses SVG markup into a node that is safe to insert: no scripts, no embedded HTML, no event
 * handler attributes and no links except in-document ones (#id). The markup comes from
 * circuit-to-svg, but part names and labels in it can come from anyone who edits the circuit.
 */
export function sanitizeSvg(markup: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml")
  const root = doc.documentElement
  if (!(root instanceof SVGSVGElement) || doc.querySelector("parsererror")) return null
  for (const element of root.querySelectorAll(BLOCKED_ELEMENTS)) element.remove()
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const isLink = name === "href" || name === "xlink:href" || name === "src"
      if (name.startsWith("on") || (isLink && !attribute.value.trim().startsWith("#"))) element.removeAttribute(attribute.name)
    }
  }
  return document.importNode(root, true)
}
