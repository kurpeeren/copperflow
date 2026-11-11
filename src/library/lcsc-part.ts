// EasyEDA's answer for one LCSC part (symbol, footprint and attributes) as a copperflow part: part.yaml's content,
// footprint.yaml's content and the notes a person checks. Pure; the importer fetches and writes.
import { z } from "zod"
import type { FootprintFile } from "../engine/footprints/file.js"
import { FOOTPRINT_FILE, validatePartId, type Part } from "../core/library.js"
import { convertFootprint, type ConvertedPad } from "./easyeda-footprint.js"
import { pinName, pinType, symbolPins, type SymbolPin } from "./easyeda-symbol.js"

/** What the source asks every use of its data to name, with both links. */
export const SOURCE_NAME = "JLCEDA/EasyEDA Official Library"
export const SOURCE_LINKS = ["https://lceda.cn/", "https://easyeda.com"] as const

/**
 * EasyEDA draws footprints with rows horizontal and pin 1 at the bottom left, which is JLCPCB's assembly orientation
 * (so pick-and-place needs no correction, `file: 0`) and copperflow's generated convention turned +90°.
 */
export const ORIENTATION_NOTE = "The footprint keeps the source's orientation; place at pcbRotation -90 to match a generated footprint of the same package."

const LCSC_NUMBER = /^C[1-9][0-9]{0,9}$/
const PIN_NUMBER = /^[1-9][0-9]*$/

const DocumentSchema = z.object({
  head: z.object({ x: z.union([z.number(), z.string()]).optional(), y: z.union([z.number(), z.string()]).optional(), c_para: z.record(z.string(), z.string()).optional(), license: z.string().optional() }).loose(),
  shape: z.array(z.string()),
})

const AnswerSchema = z.object({
  success: z.boolean(),
  result: z
    .object({
      title: z.string().optional(),
      lcsc: z.object({ number: z.string().optional(), url: z.string().optional() }).loose().optional(),
      dataStr: DocumentSchema,
      packageDetail: z.object({ dataStr: DocumentSchema }).loose(),
    })
    .loose()
    .nullish(),
})

/** The part copperflow writes for one LCSC number. */
export interface LcscPart {
  lcsc: string
  /** The part id to use when the person names none: the MPN made into an id. */
  suggestedId: string
  part: Part
  footprint: FootprintFile
  /** What the conversion approximated or changed, for the person to check. */
  notes: string[]
  /** The notices the documents carried, exactly as written (usually one, shared by symbol and footprint). */
  notices: string[]
}

/** The LCSC number as EasyEDA writes it (C and digits), or an error that says what one looks like. */
export function lcscNumber(text: string): string {
  const number = text.trim().toUpperCase()
  if (!LCSC_NUMBER.test(number)) throw new Error(`"${text}" is not an LCSC part number: it looks like C9657 (C and digits)`)
  return number
}

/** Throws when EasyEDA's answer says the part does not exist or is not the part asked for. */
export function convertLcscAnswer(answer: unknown, lcsc: string, today: string): LcscPart {
  const parsed = AnswerSchema.safeParse(answer)
  if (!parsed.success) throw new Error(`EasyEDA's answer for ${lcsc} is not a part with a symbol and a footprint`)
  const result = parsed.data.result
  if (!parsed.data.success || !result) throw new Error(`EasyEDA has no part ${lcsc}`)
  const attributes = result.dataStr.head.c_para ?? {}
  const answered = (result.lcsc?.number ?? attributes["Supplier Part"] ?? lcsc).trim().toUpperCase()
  if (answered !== lcsc) throw new Error(`EasyEDA answered with part ${answered} when asked for ${lcsc}`)
  const footprint = convertFootprint(result.packageDetail.dataStr)
  const pins = matchPins(symbolPins(result.dataStr.shape), footprint.pads)
  const name = oneLine(attributes.name ?? result.title ?? lcsc)
  const mpn = oneLine(attributes["Manufacturer Part"] ?? name)
  const manufacturer = withoutNonAscii(attributes.Manufacturer ?? "")
  const packageName = oneLine(attributes.package ?? result.packageDetail.dataStr.head.c_para?.package ?? "")
  const part: Part = {
    title: limit(packageName ? `${name}, ${packageName}` : name, 200),
    description: `From the ${SOURCE_NAME} (${SOURCE_LINKS.join(", ")}), LCSC ${lcsc}; copyright JLCEDA/EasyEDA. Imported for personal, non-commercial use only; see source.md.`,
    ...(manufacturer ? { manufacturer: limit(manufacturer, 200) } : {}),
    ...(mpn ? { mpn: limit(mpn, 100) } : {}),
    origin: `lcsc ${lcsc}, imported ${today}`,
    footprint: FOOTPRINT_FILE,
    pins: pins.pins,
    suppliers: { lcsc },
    datasheet: { url: `https://www.lcsc.com/datasheet/${lcsc}.pdf` },
  }
  const file: FootprintFile = {
    pads: pins.pads,
    courtyard: footprint.courtyard,
    ...(footprint.silkscreen.length > 0 ? { silkscreen: footprint.silkscreen } : {}),
    ...(footprint.body ? { body: footprint.body } : {}),
  }
  const notices = [...new Set([result.dataStr.head.license, result.packageDetail.dataStr.head.license].filter((n): n is string => !!n?.trim()))]
  return { lcsc, suggestedId: suggestedId(mpn, lcsc), part, footprint: file, notes: [...footprint.notes, ...pins.notes, ORIENTATION_NOTE], notices }
}

interface MatchedPins {
  pins: Part["pins"]
  pads: FootprintFile["pads"]
  notes: string[]
}

/**
 * The part's pins from the symbol, matched to the footprint's pads by number. A pad numbered other than with digits
 * (EP, MP, none) becomes a new pin after the last; a pad no symbol pin names becomes a passive pin; a symbol pin
 * without a pad becomes no_connect. Every such change is a note.
 */
export function matchPins(symbol: readonly SymbolPin[], pads: readonly ConvertedPad[]): MatchedPins {
  if (symbol.length === 0) throw new Error("the symbol has no pins")
  const odd = symbol.find((pin) => !PIN_NUMBER.test(pin.number))
  if (odd) throw new Error(`the symbol numbers a pin "${odd.number}"; copperflow numbers pins 1, 2, 3 …, so draw this part with the part wizard instead`)
  const notes: string[] = []
  const pins: Part["pins"] = {}
  for (const pin of symbol) {
    if (pins[pin.number]) {
      notes.push(`The symbol has pin ${pin.number} twice; the first (${pin.label}) is kept.`)
      continue
    }
    const name = pinName(pin.label, pin.number)
    pins[pin.number] = { name, type: pinType(pin), ...(name !== pin.label && !/^\d*$/.test(pin.label.trim()) ? { description: limit(`EasyEDA name: ${oneLine(pin.label)}`, 200) } : {}) }
  }
  let next = Math.max(...Object.keys(pins).map(Number), ...pads.filter((p) => PIN_NUMBER.test(p.number)).map((p) => Number(p.number))) + 1
  const extra = new Map<string, string>()
  const renumbered = pads.map((pad) => {
    if (PIN_NUMBER.test(pad.number)) return pad
    const label = pad.number || "(no number)"
    let number = extra.get(label)
    if (!number) {
      number = String(next++)
      extra.set(label, number)
      const name = pad.number ? pinName(pad.number, number) : `pad${number}`
      pins[number] = { name, type: "passive", description: limit(`EasyEDA pad ${oneLine(label)}`, 200) }
      notes.push(`Pad ${label} became pin ${number} (${name}, passive): footprint.yaml numbers pads with digits.`)
    }
    return { ...pad, number }
  })
  for (const number of [...new Set(renumbered.map((pad) => pad.number))]) {
    if (pins[number]) continue
    pins[number] = { name: `pad${number}`, type: "passive" }
    notes.push(`Pad ${number} has no pin in the symbol; it became pin ${number} (pad${number}, passive).`)
  }
  const padNumbers = new Set(renumbered.map((pad) => pad.number))
  for (const [number, pin] of Object.entries(pins)) {
    if (padNumbers.has(number)) continue
    pins[number] = { ...pin, type: "no_connect" }
    notes.push(`Pin ${number} (${pin.name}) has no pad in the footprint; it is marked no_connect.`)
  }
  return { pins: sortedPins(pins), pads: renumbered, notes }
}

function sortedPins(pins: Part["pins"]): Part["pins"] {
  return Object.fromEntries(Object.entries(pins).sort(([a], [b]) => Number(a) - Number(b)))
}

/** The MPN as a part id (letters, digits, ".", "_" and "-", starting with a letter), or the LCSC number. */
function suggestedId(mpn: string, lcsc: string): string {
  const base = mpn.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/\.{2,}/g, ".").slice(0, 60).replace(/[^A-Za-z0-9]+$/, "")
  try {
    return validatePartId(base)
  } catch {
    return lcsc
  }
}

/** A manufacturer without the bracketed name in another script that EasyEDA adds after it ("onsemi(…)" is "onsemi"). */
function withoutNonAscii(text: string): string {
  return oneLine(text.replace(/[(（][^)）]*[^\x00-\x7f][^)）]*[)）]/g, "").replace(/[^\x20-\x7e]/g, ""))
}

function oneLine(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim()
}

function limit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
