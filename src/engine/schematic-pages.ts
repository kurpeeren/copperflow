// A schematic page as a circuit of its own: the parts, traces and drawings drawn on it, and the nets cut down to its
// pins. Pages are drawing only, so the nets stay the circuit's; this view only decides what one page shows.
import { diagnostic } from "./diagnostics.js"
import { MAIN_PAGE, pageOf, type Circuit, type Connection, type Diagnostic } from "./model.js"

/** The pages of a circuit, MAIN_PAGE first; a circuit made by hand is one page. */
export const pagesOf = (circuit: Circuit): string[] => circuit.pages ?? [MAIN_PAGE]

const pinEnds = (connection: Connection): string[] => [connection.from, connection.to].filter((end) => !end.startsWith("net."))

/** The page of every pin, by pin id. */
function pinPages(circuit: Circuit): Map<string, string> {
  return new Map(circuit.components.flatMap((component) => component.pins.map((pin): [string, string] => [pin.id, pageOf(component)])))
}

/** The page a connection is drawn on: the page of its pins, or none when they are on different pages. */
function connectionPage(connection: Connection, pages: ReadonlyMap<string, string>): string | undefined {
  const found = new Set(pinEnds(connection).map((pin) => pages.get(pin)))
  const [only] = found
  return found.size === 1 ? only : undefined
}

/** The circuit as one page shows it. With one page it is the circuit itself. */
export function pageView(circuit: Circuit, page: string): Circuit {
  if (pagesOf(circuit).length === 1) return circuit
  const pages = pinPages(circuit)
  const here = (pin: string) => pages.get(pin) === page
  return {
    ...circuit,
    pages: [page],
    components: circuit.components.filter((component) => pageOf(component) === page),
    nets: circuit.nets.map((net) => ({ ...net, pins: net.pins.filter(here) })).filter((net) => net.pins.length > 0),
    connections: circuit.connections.filter((connection) => connectionPage(connection, pages) === page),
    drawings: circuit.drawings.filter((drawing) => pageOf(drawing) === page),
  }
}

/** The ids of the nets whose pins are on more than one page: each of their pieces carries a label. */
export function netsAcrossPages(circuit: Circuit): Set<string> {
  const pages = pinPages(circuit)
  return new Set(circuit.nets.filter((net) => new Set(net.pins.map((pin) => pages.get(pin))).size > 1).map((net) => net.id))
}

/** A warning for each trace between pins on two pages: no page can draw it, though it still joins the net. */
export function tracesAcrossPages(circuit: Circuit): Diagnostic[] {
  if (pagesOf(circuit).length === 1) return []
  const pages = pinPages(circuit)
  return circuit.connections.flatMap((connection) => {
    const ends = pinEnds(connection)
    if (ends.length < 2 || connectionPage(connection, pages) !== undefined || ends.some((pin) => !pages.has(pin))) return []
    const where = ends.map((pin) => `${pin} (${pages.get(pin)})`).join(" and ")
    const message = `The trace between ${where} joins pins on two pages and is not drawn; connect them with a net label on each page`
    return [diagnostic("trace-across-pages", "warning", message, ends, connection.source)]
  })
}
