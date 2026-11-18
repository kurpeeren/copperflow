// The style and the few lines of script of the one-file web page (html-page.ts): system fonts, light and dark by the
// reader's setting, a phone-width layout, clean print with each picture on its own sheet. The header is laid out as a
// drawing's title block; views of the board share one frame and are chosen with plain radio buttons, so the page
// works with scripts off. Nothing here comes from the user's files.

/** How many views one frame can switch between; the style holds one rule set for each. */
const MAX_VIEWS = 6

const viewRules = Array.from({ length: MAX_VIEWS }, (_, i) => i + 1)
  .map(
    (n) => `.views > input:nth-of-type(${n}):checked ~ figure:nth-of-type(${n}) { display: block; }
.views > input:nth-of-type(${n}):checked ~ .tabs label:nth-of-type(${n}) { color: var(--ink); border-bottom-color: var(--copper); font-weight: 600; }
.views > input:nth-of-type(${n}):focus-visible ~ .tabs label:nth-of-type(${n}) { outline: 2px solid var(--copper); outline-offset: -2px; }`,
  )
  .join("\n")

export const PAGE_STYLE = `
:root { color-scheme: light dark; --ink: #14171a; --muted: #5b6268; --rule: #cfd3d6; --paper: #f6f7f7; --panel: #eceeef; --copper: #9a4a1c; --yes: #1f6b3a; --no: #8a4b00; --mono: ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --ink: #e6e8ea; --muted: #9aa1a8; --rule: #353a3f; --paper: #101214; --panel: #191c1f; --copper: #e0935a; --yes: #6fc48d; --no: #e0a851; } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-padding-top: 56px; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 16px 14px 56px; }
a { color: var(--copper); }
h1 { font-size: clamp(1.6rem, 5vw, 2.5rem); line-height: 1.1; font-weight: 650; letter-spacing: -0.01em; margin: 0; overflow-wrap: anywhere; }
h2 { font-size: 1.15rem; font-weight: 650; margin: 0 0 12px; }
h3 { font-size: 0.95rem; margin: 20px 0 8px; color: var(--muted); font-weight: 600; }
section { margin-top: 36px; padding-top: 16px; border-top: 2px solid var(--ink); }
.note, figcaption { color: var(--muted); font-size: 0.88rem; }
.title-block { border: 2px solid var(--ink); display: grid; grid-template-columns: 1fr; }
.title-block > * { padding: 12px 14px; }
.tb-name { border-bottom: 1px solid var(--rule); }
.tb-label, dt { margin: 0 0 2px; font-size: 0.75rem; color: var(--muted); }
.tb-fields { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; border-bottom: 1px solid var(--rule); }
.tb-fields div { min-width: 0; }
dd { margin: 0; font-family: var(--mono); font-size: 0.9rem; overflow-wrap: anywhere; }
.report { margin: 0; list-style: none; font-size: 0.92rem; }
.report li { margin: 3px 0; padding-left: 14px; position: relative; }
.report li::before { content: ""; position: absolute; left: 0; top: 0.55em; width: 7px; height: 7px; background: var(--rule); }
.report li.yes::before { background: var(--yes); }
.report li.no::before { background: var(--no); }
nav { position: sticky; top: 0; z-index: 5; margin: 0 -14px; padding: 8px 14px; background: var(--paper); border-bottom: 1px solid var(--rule); display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden; white-space: nowrap; }
nav a { padding: 6px 10px; text-decoration: none; color: var(--ink); border: 1px solid transparent; }
nav a:hover, nav a:focus-visible { border-color: var(--copper); color: var(--copper); }
.files { display: grid; grid-template-columns: 1fr; gap: 8px; margin: 0 0 10px; }
.button { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; align-items: baseline; min-height: 56px; padding: 10px 14px; border: 1px solid var(--rule); border-left: 4px solid var(--copper); background: var(--panel); color: var(--ink); text-decoration: none; }
.button:hover, .button:focus-visible { border-color: var(--copper); outline: none; }
.file-name { font-family: var(--mono); font-weight: 600; overflow-wrap: anywhere; }
.file-size { font-family: var(--mono); color: var(--muted); font-size: 0.85rem; }
.file-what { grid-column: 1 / -1; color: var(--muted); font-size: 0.88rem; }
.views { position: relative; }
.views > input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.tabs { display: flex; overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid var(--rule); }
.tabs label { padding: 9px 14px; cursor: pointer; white-space: nowrap; color: var(--muted); border-bottom: 3px solid transparent; margin-bottom: -1px; }
.views > figure { display: none; }
${viewRules}
figure { margin: 12px 0 0; }
.pan { overflow-x: auto; border: 1px solid var(--rule); background: #ffffff; }
figure img { display: block; max-width: 100%; height: auto; cursor: zoom-in; }
figcaption { margin-top: 6px; overflow-wrap: anywhere; }
figure.open { position: fixed; inset: 0; z-index: 10; margin: 0; padding: 12px; background: rgba(0, 0, 0, 0.9); overflow: auto; display: block; }
figure.open .pan { overflow: visible; border: 0; background: none; }
figure.open img { max-width: none; margin: 0 auto; cursor: zoom-out; }
figure.open figcaption { color: #e6e8ea; text-align: center; }
figure.open figcaption::after { content: " Tap the picture or press Esc to close."; }
.table { overflow-x: auto; max-width: 100%; }
table { border-collapse: collapse; min-width: 100%; font-size: 0.92rem; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--rule); vertical-align: top; white-space: nowrap; }
td.designators { white-space: normal; overflow-wrap: normal; word-break: normal; min-width: 8em; max-width: 22em; font-family: var(--mono); }
th { font-weight: 600; font-size: 0.8rem; color: var(--muted); border-bottom: 2px solid var(--ink); }
th.number, td.number { text-align: right; }
.unverified { font-weight: 600; color: var(--no); }
footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.85rem; }
@media (max-width: 640px) {
  figure.wide img { min-width: 640px; max-width: none; }
  figure.wide figcaption::before { content: "Swipe sideways to see the rest. "; }
  table, thead, tbody, tr, td { display: block; }
  thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  tr { padding: 10px 0; border-bottom: 2px solid var(--rule); }
  td, td.designators { white-space: normal; border: 0; padding: 2px 0; min-width: 0; max-width: none; }
  td { display: grid; grid-template-columns: 7.5em 1fr; gap: 8px; }
  td.number { text-align: left; }
  td:empty { display: none; }
  td::before { color: var(--muted); font-family: system-ui, sans-serif; font-size: 0.82rem; }
  td:nth-child(1)::before { content: "Designators"; }
  td:nth-child(2)::before { content: "Quantity"; }
  td:nth-child(3)::before { content: "Kind"; }
  td:nth-child(4)::before { content: "Value"; }
  td:nth-child(5)::before { content: "Footprint"; }
  td:nth-child(6)::before { content: "Supplier"; }
  td:nth-child(7)::before { content: "Library part"; }
}
@media (min-width: 700px) {
  body { font-size: 16px; }
  main { padding: 28px 20px 72px; }
  nav { margin: 0 -20px; padding: 8px 20px; }
  .title-block { grid-template-columns: 1.4fr 1fr; }
  .tb-name { border-bottom: 0; border-right: 1px solid var(--rule); grid-row: span 2; display: flex; flex-direction: column; justify-content: flex-end; }
  .files { grid-template-columns: 1fr 1fr; }
}
@media print {
  :root { --ink: #000000; --muted: #444444; --rule: #bbbbbb; --paper: #ffffff; --panel: #ffffff; --copper: #000000; --yes: #000000; --no: #000000; }
  main { max-width: none; padding: 0; }
  nav, .files, .tabs, .views > input { display: none; }
  .views > figure { display: block !important; }
  figure.sheet { break-before: page; break-inside: avoid; }
  figure img { max-height: 90vh; min-width: 0 !important; max-width: 100% !important; }
  h2 { break-after: avoid; }
}
`

/** A click on a picture opens it larger in place; a second click or Escape closes it. */
export const PAGE_SCRIPT = `
document.addEventListener("click", function (event) {
  var figure = event.target.closest && event.target.closest("figure");
  if (figure) figure.classList.toggle("open");
});
document.addEventListener("keydown", function (event) {
  if (event.key !== "Escape") return;
  document.querySelectorAll("figure.open").forEach(function (figure) { figure.classList.remove("open"); });
});
`
