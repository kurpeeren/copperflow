// The one-file web page of a design (copperflow html, export_html): pure, the gathered data in and the HTML out.
// Every word that comes from the user's files is escaped here; pictures and files are embedded as data URIs, so the
// page opens from disk and fetches nothing.
import type { BomLine } from "./bom.js"
import { PAGE_SCRIPT, PAGE_STYLE } from "./html-style.js"

/** Where a reader of a shared page finds the program. */
export const PROJECT_URL = "https://copperflow.kurpeeren.com"

export interface PagePicture {
  png: Uint8Array
  width: number
  height: number
  /** What the picture shows: its own caption line. */
  alt: string
  /** A short name for the view's tab ("Top, as made"); the page numbers the views when left out. */
  title?: string
}

export interface PageDownload {
  /** The file name the browser saves it as. */
  name: string
  mime: string
  label: string
  bytes: Uint8Array
}

export interface PageData {
  name: string
  version: string
  /** The day written on the page, "YYYY-MM-DD". */
  date: string
  /** The order report's lines the header carries. */
  report: string[]
  schematic: { page: string; picture: PagePicture }[]
  board: PagePicture[]
  threeD: PagePicture[]
  bom: BomLine[]
  downloads: PageDownload[]
  /** Why the fabrication files are not in the page, when they are not. */
  fabricationMissing?: string
}

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

/** Text made safe for HTML content and quoted attributes. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c] as string)

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")
const kilobytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} kB`

const SECTIONS = [
  ["files", "Files"],
  ["schematic", "Schematic"],
  ["board", "Board"],
  ["three-d", "3D"],
  ["bom", "Bill of materials"],
] as const

/** Pictures at least this many times wider than tall keep a readable width on a phone and pan sideways. */
const WIDE = 1.5

function figure(picture: PagePicture, caption = picture.alt): string {
  const alt = escapeHtml(picture.alt)
  const wide = picture.width >= picture.height * WIDE ? " wide" : ""
  return [
    `<figure class="sheet${wide}">`,
    `<div class="pan"><img src="data:image/png;base64,${base64(picture.png)}" width="${picture.width}" height="${picture.height}" alt="${alt}"></div>`,
    `<figcaption>${escapeHtml(caption)}</figcaption>`,
    "</figure>",
  ].join("\n")
}

/** Several views in one frame, chosen with radio buttons (no script needed); one view is just its figure. */
function views(id: string, pictures: readonly PagePicture[]): string {
  if (pictures.length < 2) return pictures.map((picture) => figure(picture)).join("\n")
  const name = `${id}-view`
  const inputs = pictures.map((_, i) => `<input type="radio" name="${name}" id="${name}-${i}"${i === 0 ? " checked" : ""}>`)
  const labels = pictures.map((picture, i) => `<label for="${name}-${i}">${escapeHtml(picture.title ?? `View ${i + 1}`)}</label>`)
  return ['<div class="views">', ...inputs, `<div class="tabs">${labels.join("")}</div>`, ...pictures.map((picture) => figure(picture)), "</div>"].join("\n")
}

/** A report line's mark: a "Ready for ...: yes" line is good news, a "...: no" one is not. */
const reportMark = (line: string): string => (/^Ready for [^:]*: yes/.test(line) ? ' class="yes"' : /^Ready for [^:]*: no/.test(line) ? ' class="no"' : "")

function header(data: PageData): string {
  const contents = SECTIONS.map(([id, title]) => `<a href="#${id}">${title}</a>`).join("")
  return [
    '<header class="title-block">',
    `<div class="tb-name"><p class="tb-label">Design</p><h1>${escapeHtml(data.name)}</h1></div>`,
    `<dl class="tb-fields"><div><dt>Date</dt><dd>${escapeHtml(data.date)}</dd></div><div><dt>Tool</dt><dd>made with copperflow ${escapeHtml(data.version)}</dd></div></dl>`,
    `<ul class="report">${data.report.map((line) => `<li${reportMark(line)}>${escapeHtml(line)}</li>`).join("")}</ul>`,
    "</header>",
    `<nav aria-label="Contents">${contents}</nav>`,
  ].join("\n")
}

function filesSection(data: PageData): string {
  const links = data.downloads.map(
    (file) =>
      `<a class="button" href="data:${file.mime};base64,${base64(file.bytes)}" download="${escapeHtml(file.name)}"><span class="file-name">${escapeHtml(file.name)}</span><span class="file-size">${kilobytes(file.bytes.length)}</span><span class="file-what">${escapeHtml(file.label)}</span></a>`,
  )
  return [
    '<section id="files">',
    "<h2>Files</h2>",
    `<div class="files">${links.join("\n")}</div>`,
    ...(data.fabricationMissing === undefined ? [] : [`<p class="note">No fabrication files: ${escapeHtml(data.fabricationMissing)}</p>`]),
    '<p class="note">The files are inside this page; nothing is fetched.</p>',
    "</section>",
  ].join("\n")
}

function schematicSection(data: PageData): string {
  const pages = data.schematic.map(({ page, picture }) => [`<h3>${escapeHtml(page)}</h3>`, figure(picture)].join("\n"))
  return ['<section id="schematic">', "<h2>Schematic</h2>", ...pages, "</section>"].join("\n")
}

function picturesSection(id: string, title: string, pictures: readonly PagePicture[]): string {
  return [`<section id="${id}">`, `<h2>${title}</h2>`, views(id, pictures), "</section>"].join("\n")
}

const BOM_COLUMNS = ["Designators", "Quantity", "Kind", "Value", "Footprint", "Supplier number", "Library part"]

function bomRow(line: BomLine): string {
  const status = line.libraryPart === undefined ? "" : `${escapeHtml(line.libraryPart)}${line.verified === true ? "" : ' <span class="unverified">(not verified)</span>'}`
  const cells = [line.designators.join(", "), line.kind, line.value, line.footprint, line.supplier].map(escapeHtml)
  return `<tr><td class="designators">${cells[0]}</td><td class="number">${line.quantity}</td><td>${cells[1]}</td><td>${cells[2]}</td><td>${cells[3]}</td><td>${cells[4]}</td><td>${status}</td></tr>`
}

function bomSection(data: PageData): string {
  const unverified = data.bom.filter((line) => line.libraryPart !== undefined && line.verified !== true).flatMap((line) => line.designators)
  const note = unverified.length > 0 ? `<p class="note">Not verified against their datasheets: ${escapeHtml(unverified.join(", "))}.</p>` : ""
  return [
    '<section id="bom">',
    "<h2>Bill of materials</h2>",
    '<div class="table"><table>',
    `<thead><tr>${BOM_COLUMNS.map((column) => `<th scope="col"${column === "Quantity" ? ' class="number"' : ""}>${column}</th>`).join("")}</tr></thead>`,
    `<tbody>${data.bom.map(bomRow).join("\n")}</tbody>`,
    "</table></div>",
    note,
    "</section>",
  ].join("\n")
}

/** The whole page as one HTML string; the same data gives the same text. */
export function htmlPage(data: PageData): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="generator" content="copperflow ${escapeHtml(data.version)}">`,
    `<title>${escapeHtml(data.name)}</title>`,
    `<style>${PAGE_STYLE}</style>`,
    "</head>",
    "<body>",
    "<main>",
    header(data),
    filesSection(data),
    schematicSection(data),
    picturesSection("board", "Board", data.board),
    picturesSection("three-d", "3D", data.threeD),
    bomSection(data),
    `<footer>${escapeHtml(data.name)}, ${escapeHtml(data.date)}. The pictures and the files are inside this page.</footer>`,
    // A quiet credit so a shared page tells the reader which program made it; the only link that leaves the page.
    `<p class="made-with">Made with <a href="${PROJECT_URL}" target="_blank" rel="noopener">copperflow</a> ${escapeHtml(data.version)}</p>`,
    "</main>",
    `<script>${PAGE_SCRIPT}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n")
}
