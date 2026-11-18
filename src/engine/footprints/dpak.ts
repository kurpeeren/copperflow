import type { Point } from "../model.js"
import { centredOffsets, courtyard, padExtent, SILK_CLEARANCE, tidy, closedRectangle } from "./outline.js"
import { gullWingRow, range, type IcPackage } from "./ic.js"
import { roundRectPad, type Range } from "./ipc7351.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * A surface-mount power package with gull-wing leads along the bottom and a wide soldered tab on top
 * (DPAK, D2PAK). `pkg.span` is the overall length from the lead toes to the far end of the tab,
 * `pkg.bodyAcross` the plastic body along the leads, `pkg.bodyAlong` its width across them.
 */
interface TabPackage {
  name: string
  pkg: IcPackage
  /** The pad numbers of the leads, left to right; a cut lead (DPAK pin 2) is left out. */
  leads: readonly string[]
  /** Positions of the leads along x, in the order of `leads`. */
  leadX: readonly number[]
  /** The tab's pad number. */
  tabNumber: string
  tabWidth: Range
  /** How far the soldered underside of the tab reaches in from the tab end. */
  tabLength: Range
  /** How far the tab sticks out past the plastic body. */
  tabOverhang: Range
}

/**
 * onsemi, "DPAK-3 6.10x6.54x2.28, 2.29P", case 369C, issue L, 24 Aug 2026, document 98AON10527D,
 * page 1, dimension table (mm): H 9.40–10.41 (overall, lead toes to tab end), L 1.40–1.78 (foot),
 * b 0.63–0.89 (lead width), b3 4.57–5.46 (tab width), D 5.97–6.22 (body along the leads),
 * E 6.35–6.73 (body width), e 2.29, L3 0.89–1.27 (tab past the body), Z 3.93 min (thermal pad
 * contour on the underside, from the body's tab edge). The drawing numbers the leads 1 and 3 (pin 2
 * is cut short) and the tab 4. https://www.onsemi.com/download/package-drawing/pdf/369C.PDF
 *
 * Makers' drawings call the tab pin 4 or pin 2; copperflow numbers it 2, the cut middle lead's
 * terminal, so a three-pin part (regulator, MOSFET) maps its pins straight onto the pads, as the
 * SOT-89 tab in `sotpower.ts` is pin 2.
 *
 * The tab's soldered length is taken as L3 + Z (4.82–5.20 mm); Z has only a minimum, used for both
 * ends. That is a choice made here.
 */
const DPAK: TabPackage = {
  name: "dpak",
  pkg: {
    label: "DPAK (TO-252)",
    pitch: 2.29,
    span: range(9.4, 10.41),
    terminal: range(1.4, 1.78),
    leadWidth: range(0.63, 0.89),
    bodyAcross: range(5.97, 6.22),
    bodyAlong: range(6.35, 6.73),
  },
  leads: ["1", "3"],
  leadX: [-2.29, 2.29],
  tabNumber: "2",
  tabWidth: range(4.57, 5.46),
  tabLength: range(0.89 + 3.93, 1.27 + 3.93),
  tabOverhang: range(0.89, 1.27),
}

/**
 * onsemi, "D2PAK 3", case 418B-04, issue L, 17 Feb 2015, document 98ASB42761B, page 1, dimension
 * table (mm): S 14.60–15.88 (overall, lead toes to tab end), A 8.64–9.65 (body along the leads),
 * B 9.65–10.29 (body width), D 0.51–0.89 (lead width), G 2.54, H 2.03–2.79 (read here as the foot on
 * the board, as the side view draws it), F 7.87–8.89 (tab width on the underside), L 1.32–1.83 (tab
 * past the body), M 7.11–8.13 (tab underside under the body). The drawing numbers the leads 1 and 3
 * (pin 2 cut short) and the tab 4; copperflow numbers the tab 2, as for the DPAK above.
 * https://www.onsemi.com/download/package-drawing/pdf/418b-04.pdf
 *
 * The tab's soldered length is taken as L + M (8.43–9.96 mm), a choice made here.
 */
const D2PAK_BODY = {
  span: range(14.6, 15.88),
  bodyAcross: range(8.64, 9.65),
  bodyAlong: range(9.65, 10.29),
}
const D2PAK_TAB = { tabWidth: range(7.87, 8.89), tabLength: range(1.32 + 7.11, 1.83 + 8.13), tabOverhang: range(1.32, 1.83) }

const D2PAK: TabPackage = {
  name: "d2pak",
  pkg: { label: "D2PAK (TO-263)", pitch: 2.54, terminal: range(2.03, 2.79), leadWidth: range(0.51, 0.89), ...D2PAK_BODY },
  leads: ["1", "3"],
  leadX: [-2.54, 2.54],
  tabNumber: "2",
  ...D2PAK_TAB,
}

/**
 * D2PAK-5 and D2PAK-7 (TO-263-5, TO-263-7): the D2PAK body and tab above with five leads at 1.70 mm
 * (lead width 0.51–0.89 is kept) or seven at 1.27 mm (lead width 0.50–0.70), feet 2.03–2.79. The
 * lead counts, pitches and the seven-lead width are written from general knowledge of makers' TO-263-5
 * and TO-263-7 drawings, not transcribed from one drawing; a part's own drawing should confirm.
 */
function d2pakMany(count: number, pitch: number, leadWidth: Range): TabPackage {
  return {
    name: `d2pak_${count}`,
    pkg: { label: `D2PAK-${count} (TO-263-${count})`, pitch, terminal: range(2.03, 2.79), leadWidth, ...D2PAK_BODY },
    leads: Array.from({ length: count }, (_, i) => String(i + 1)),
    leadX: centredOffsets(count, pitch),
    tabNumber: String(count + 1),
    ...D2PAK_TAB,
  }
}

const D2PAK_5 = d2pakMany(5, 1.7, range(0.51, 0.89))
const D2PAK_7 = d2pakMany(7, 1.27, range(0.5, 0.7))

/** The tab land runs this much (the gull-wing heel goal of Table 3-2) past the tab's soldered length. */
const TAB_HEEL = 0.35

/**
 * The leads' pads come from the gull-wing equations (IPC-7351B Table 3-2 with Note 1 against the body
 * along the leads), mirrored as if the tab were a second row of leads, as `sotpower.ts` does for
 * SOT-223. The tab land starts at the same outer edge as a lead land would (the tab end is the far
 * toe of the span) and runs in over the tab's soldered length plus `TAB_HEEL`; its width is the X of
 * the equations for the tab width. The tab land length is a choice made here, not an IPC-7351B rule.
 * The tab takes `tabNumber`: 2 on the three-terminal packages, the number after the last lead on
 * the five- and seven-lead ones.
 */
function tabPads(tab: TabPackage): Pad[] {
  const { row } = gullWingRow(tab.pkg)
  const tabRow = gullWingRow({ ...tab.pkg, leadWidth: tab.tabWidth }).row
  const leads = tab.leads.map((number, i) => roundRectPad(number, tab.leadX[i] as number, -row.centre, row.width, row.length))
  const outer = row.centre + row.length / 2
  const inner = outer - tab.tabLength.max - TAB_HEEL
  return [...leads, roundRectPad(tab.tabNumber, 0, tidy((outer + inner) / 2), tabRow.width, tidy(outer - inner))]
}

/** The body: from the tab edge (the tab end less its overhang) back over the body length. */
function bodyBox(tab: TabPackage): { top: number; bottom: number; half: number } {
  const top = tidy(tab.pkg.span.max / 2 - tab.tabOverhang.min)
  return { top, bottom: tidy(top - tab.pkg.bodyAcross.max), half: tidy(tab.pkg.bodyAlong.max / 2) }
}

/** Lines along the body's left and right edges, clear of the pads; the left one runs down past pad 1. */
function tabSilkscreen(pads: readonly Pad[], tab: TabPackage): Point[][] {
  const body = bodyBox(tab)
  const x = tidy(Math.max(body.half, padExtent(pads).x + SILK_CLEARANCE))
  const bottom = tidy(-padExtent(pads).y)
  return [
    [{ x: -x, y: bottom }, { x: -x, y: body.top }],
    [{ x, y: body.bottom }, { x, y: body.top }],
  ]
}

function fabrication(tab: TabPackage): Point[][] {
  const body = bodyBox(tab)
  const shift = (points: Point[]) => points.map((p) => ({ x: p.x, y: tidy(p.y + (body.top + body.bottom) / 2) }))
  const outline = shift(closedRectangle({ x: body.half, y: (body.top - body.bottom) / 2 }))
  const tabEnd = tidy(tab.pkg.span.max / 2)
  const tabHalf = tidy(tab.tabWidth.max / 2)
  return [outline, [{ x: -tabHalf, y: body.top }, { x: -tabHalf, y: tabEnd }, { x: tabHalf, y: tabEnd }, { x: tabHalf, y: body.top }]]
}

function tabFootprint(tab: TabPackage): Footprint {
  const pads = tabPads(tab)
  const { table } = gullWingRow(tab.pkg)
  const component = { x: tab.pkg.bodyAlong.max / 2, y: tab.pkg.span.max / 2 }
  return {
    name: tab.name,
    pads,
    courtyard: courtyard(pads, component, table),
    silkscreen: tabSilkscreen(pads, tab),
    fabrication: fabrication(tab),
    origin: `IPC-7351B nominal, ${tab.pkg.label}`,
  }
}

/** "dpak", "to252", "d2pak", "to263", "d2pak_5", "to263_5", "d2pak_7", "to263_7". */
const BY_KEY = new Map<string, TabPackage>([
  ["dpak", DPAK],
  ["to252", DPAK],
  ["d2pak", D2PAK],
  ["to263", D2PAK],
  ["d2pak_5", D2PAK_5],
  ["to263_5", D2PAK_5],
  ["d2pak_7", D2PAK_7],
  ["to263_7", D2PAK_7],
])

function keyOf(parsed: ParsedFootprint): string | undefined {
  const head = `${parsed.kind}${parsed.code}${parsed.suffix ?? ""}`
  const plain = parsed.cross === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (!plain || Object.keys(parsed.params).length > 0) return undefined
  return parsed.variant === undefined ? head : `${head}_${parsed.variant}`
}

const isTabHead = (parsed: ParsedFootprint) =>
  (parsed.kind === "to" && (parsed.code === "252" || parsed.code === "263") && isSimple(parsed)) ||
  (parsed.kind === "dpak" && parsed.code === "") ||
  (parsed.kind === "d" && parsed.code === "2" && parsed.suffix === "pak")

/**
 * The IPC-7351B nominal footprint for a DPAK or D2PAK string; a refusal for other lead counts of
 * those names ("d2pak_4", "dpak_5"); otherwise undefined.
 */
export function dpakFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (!isTabHead(parsed)) return undefined
  const key = keyOf(parsed)
  const tab = key === undefined ? undefined : BY_KEY.get(key)
  if (tab) return tabFootprint(tab)
  const dpak = parsed.kind === "dpak" || parsed.code === "252"
  return refuse(dpak ? "a DPAK takes no variant or parameters" : "a D2PAK has 3 (no variant), 5 or 7 leads")
}
