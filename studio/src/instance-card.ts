// What an instance's sheet says of itself, for the Inspector: what it does, its sources, and each port's type and
// what it carries. Written without JSX so the tests render it as they render the other plain modules.
import { createElement as h, type ReactElement } from "react"
import type { SheetInstance } from "../../src/engine/model.js"

const WEB_ADDRESS = /^https?:\/\//

/** A port's type and what it carries, "input, 0 to 24 V from the field"; empty when the sheet says neither. */
export const portAbout = (port: Pick<SheetInstance["ports"][number], "type" | "carries">): string => [port.type, port.carries].filter(Boolean).join(", ")

/** What the instance's sheet does and its sources, a web address as a link; nothing when it says neither. */
export function InstanceCard({ instance }: { instance: Pick<SheetInstance, "does" | "sources"> }): ReactElement | null {
  const sources = instance.sources ?? []
  if (!instance.does && sources.length === 0) return null
  const item = (source: string) => h("li", { key: source }, WEB_ADDRESS.test(source) ? h("a", { href: source, target: "_blank", rel: "noreferrer" }, source) : source)
  return h(
    "div",
    { className: "instance-card" },
    instance.does ? h("p", { className: "note" }, instance.does) : null,
    sources.length > 0 ? h("ul", { className: "instance-sources" }, sources.map(item)) : null,
  )
}
