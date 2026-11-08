# Studio UX round 1: the EasyEDA-style shell

Spec: `docs/studio-easyeda-parity.md` (§1–§5 and §10 round 1). Map of EasyEDA's editor: `docs/editor-map.md`.

Goal: Studio's frame looks and is laid out like EasyEDA Pro's editor: light chrome, a menu bar, a toolbar for the open document, vertical tab strips at both window edges, document tabs above the canvas, a bottom tab strip, and Properties in sections. The panels that exist today move into these places; their content and behaviour stay the same. Canvas drawing colours are round 2 and are not touched here.

## Global constraints

- Everything in the repo is in English. Commit messages are one short plain English line with no `type:` prefix and no trailer of any kind (no Co-Authored-By, no tool names).
- No EasyEDA code, icons, logos or artwork. Icons are our own simple SVGs in `studio/src/icons.tsx` (24×24 viewBox, `currentColor` strokes, 1.5px lines).
- No "tscircuit" text anywhere on screen.
- No new dependencies.
- `studio/src/styles.css` must not grow (a test caps it at 940 lines). New rules go in their own sheet next to the component (`shell.css`, `panels.css`, …), imported by that component, as `checks-panel.css` does.
- Functions under 50 lines, files under 800 lines, no nesting deeper than 4.
- Logic goes in plain `.ts` modules with unit tests under `test/` (Studio has no DOM tests). Components stay thin.
- Keys: the panel keys go by the character they produce and also work with AltGr (Turkish Q keyboard); Alt combinations go by the physical key. Do not break `test/canvas-keys.test.ts`.
- Every task ends with `npm run typecheck`, `npm test` and `npm run build` passing.
- Do not change files under `src/engine/` or `src/core/` in this round.

## Task 1: light chrome

Replace the dark theme with the light chrome of the spec's §2 table.

- In `studio/src/styles.css`, rewrite the `:root` tokens with the spec's values. Keep the token names that the rest of the sheet uses where they still make sense, mapping each to its light value: `--ground` → behind-canvas `#cccccc`, `--panel` → `#ffffff`, `--raised` → `#f5f5f5`, `--line` → `#d1d1d1`, `--text` → `#333333`, `--muted` → `#999999`, `--copper` and `--copper-strong` → accent `#1890ff` and `#096dd9`, `--copper-wash` → `#e6f7ff`, `--danger` → `#f5222d`. Add `--strip: #f0f0f0`, `--tab: #eeeeee`, `--warning: #faad14`. `color-scheme: light`.
- Font: `12px/1.5 Arial, "Microsoft YaHei", Helvetica, sans-serif` on `body`. Buttons 24px high, 2px corners, `1px solid var(--line)`, white background, `#f5f5f5` on hover.
- Go through the sheet and `checks-panel.css` and fix every rule whose colour was written for a dark ground (hard-coded `#…` dark values, `rgb(… / …%)` washes, white text). After this task, no text in the chrome is light on light or dark on dark.
- The canvases still draw with their own colours; only the CSS around them changes. `.pcb-canvas` and `.schematic-canvas` keep a dark background for now (`#000000` for PCB, `#FFFCF8` for the schematic, the spec's §6 backgrounds).
- Test: extend `test/studio-styles.test.ts` so it reads `:root` from `styles.css` and checks `--text`, `--panel`, `--line`, `--copper` (accent) and `--strip` against the values above.

## Task 2: menu bar

A menu bar replaces today's top bar (`header.topbar` in `App.tsx`).

- New `studio/src/shell/menus.ts`: the menu definitions as data, per the spec's §3 table. Each item has `label`, optional `shortcut` (display text such as `Ctrl+Z`, `Alt+W`, `Shift+F`, `Space`, `K`, `Q`, `H`, `Shift+H`, `[`, `]`, `\`), and either `command` (a `CommandId` string union) or `pending` (a short reason such as `"Comes with routing (stage 4)"`). Separators are allowed between groups. Menus: File, Edit, View, Place, Design, Route, Layout, Tools, Export, Settings, Help. Route and Settings hold only pending items (Route: Single routing `Alt+W`, Via `Alt+V`, Auto routing; Settings: System, Hotkeys). Fill the other menus' pending items from `docs/editor-map.md` §3 so the menus read like EasyEDA's, but keep each menu to at most 14 items.
- Also in `menus.ts`: a pure reducer for the open menu: `{ open: string | null }` with events `click(title)`, `hover(title)`, `escape`, `outside`, `run`. A click opens, or closes when that menu is open; a hover switches only while one is open; escape, outside and run close.
- New `studio/src/shell/MenuBar.tsx` (+ `shell.css`): 32px high, white, bottom border `--line`. Brand "copperflow" at the left (bold, accent colour), then the titles (12px, 8px padding, hover `#f0f0f0`, the open one `--copper-wash`). A dropdown is a white box with a 1px border and a small shadow, items 28px high, the shortcut right-aligned in `--muted`, disabled items in `--muted` with the reason as the `title` tooltip. The file selector and the build status pill and Undo move to the right end of the menu bar.
- `App.tsx` maps each `CommandId` to what Studio does today. Commands that need a canvas (fit, zoom in, zoom out, wire, net label, rotate, highlight) are sent to the open canvas through a small command bus: a `studio/src/shell/commands.ts` module with `subscribe(handler)` and `send(command)`; each canvas subscribes while mounted and answers the commands it knows, the same way its keys do. Zoom in and zoom out scale the camera by 1.25 about the canvas centre. Place → Ground flag and Power flag arm the existing label palette with that kind.
- Tests: `test/menus.test.ts`. Every menu in the spec's order is there; every item has exactly one of `command` and `pending`; every shortcut shown for a command matches what `keyAction` in `canvas-keys.ts` does for that key (for the keys `keyAction` knows); the reducer follows the rules above.

## Task 3: toolbar

A 32px toolbar under the menu bar, per the spec's §4.

- New `studio/src/shell/toolbar.ts`: the buttons per view as data (`id`, `title` with the key in brackets, `icon` name, `command`, group number). Schematic: Undo | Zoom in, Zoom out, Fit all | Component, Wire, Net label, Ground, Power | Rotate | Check DRC. PCB: Undo | Zoom in, Zoom out, Fit all | Rotate | Check DRC.
- New `studio/src/shell/Toolbar.tsx`: 24×24 icon buttons, transparent until hovered, 1px `--line` separators between groups. It sends the same `CommandId`s as the menu.
- The canvases' own tool rows (`.canvas-top`: snap select, layer toggles, Keep these positions, the wire and palette buttons, hints) render into the toolbar's right side through a React portal into a slot element the toolbar provides (`#toolbar-view-slot`), so their state stays inside each canvas. Buttons that the new toolbar now has (fit, rotate, wire, label palette buttons) are removed from the canvas rows; the snap select, layer toggles, Keep and hints stay.
- New icons in `icons.tsx`: zoom in, zoom out, fit, component, wire, net label, ground, power, rotate, check. Simple line drawings of our own.
- Tests: `test/toolbar.test.ts`. Each view's buttons are in the order above; every button's command exists in `menus.ts`'s `CommandId`; every title that names a key matches the menu item for the same command.

## Task 4: vertical tab strips and the left panel

- New `studio/src/shell/SideStrip.tsx`: a 24px wide strip (`--strip`, border `--line` on the canvas side) with tabs whose labels are rotated (`writing-mode: vertical-rl`), each tab 24px wide with 8px padding, the active one with a 2px accent bar on the outer edge and a white background. Clicking the active tab collapses the panel; clicking another switches to it and opens the panel.
- Left strip at the window's left edge: **Project Design** and **Common Library**. Right strip at the window's right edge: **Properties** only in this round.
- `LeftPanel.tsx` becomes Project Design with sub-tabs across the top (24px high, `--strip` background, the active one white with a 2px accent bar at the bottom): **Page**, **Net**, **Component**, **Object**.
  - Page: a tree. The project folder name (the last path part of the Studio root, from a new field on `/api/circuits` or, if the server cannot give it without touching `src/studio/server.ts`, the text "Project") → each circuit file → "Schematic" and "PCB". Clicking Schematic or PCB opens that file and that document. The open document's row is highlighted with `--copper-wash`.
  - Net: today's Nets list. Component: today's Parts tree. Object: today's Wires list.
- Common Library: today's Library tab content.
- History leaves the left panel; it moves to the bottom panel's Log tab in Task 6. Until Task 6 lands, keep it reachable as a fifth sub-tab and remove it in Task 6.
- `use-workspace.ts`: `leftTab` becomes `{ strip: "design" | "library", sub: "page" | "net" | "component" | "object" }` (or two fields); `openLibrary` (Shift+F) opens Common Library and focuses the search as today. `[` and `]` still toggle the panels; a toggled-off panel leaves its strip in place.
- Panel widths: left content 231px, right content 262px.
- Tests: update `test/workspace.test.ts` for the new tab state; add pure tests for the strip toggle rule (click active → collapse, click other → switch and open).

## Task 5: document tabs

- A 24px tab bar above the canvas (`--strip`, bottom border `--line`). One tab per open document: `<file name without .circuit.tsx> Schematic` and `<file name> PCB`, 160px wide, ellipsis on overflow, inactive `--tab`, active `--copper-wash` with a 2px accent bar at the top. Both documents of the open file are always shown as tabs; tabs cannot be closed in this round.
- The Schematic/PCB switch leaves the top bar. The file selector stays at the right end of the menu bar until the Page tree covers it, then goes (keep it if the Page tree is the only other way to switch files and it works).
- Tests: a pure `docTabs(file, view)` helper with its titles and active flag.

## Task 6: bottom tab strip

- A 24px strip at the very bottom of the window, across the full width, with tabs **Library**, **Log**, **DRC**, **Find Results** (each tab 24px high, 12px padding, border `--line`, active one white with a 2px accent bar at the bottom).
- Clicking a tab opens the bottom panel (240px high, above the strip, spanning the canvas column only, as today) with that tab's content, or closes it when it is the open one. `\` toggles the panel and keeps the last tab (DRC by default).
- Library: today's Library component. Log: today's History list with undo. DRC: today's `ChecksPanel` content (its own header and close button go; the strip closes it). Find Results: an empty state, "Press Ctrl+F to find a part or a net." (round 3 fills it).
- The checks opening the panel by themselves (`opensOnBuild`) now open it on the DRC tab. The status pill opens the DRC tab.
- Remove History from the left panel.
- Tests: a pure reducer for the bottom panel (`{ open: boolean, tab }` with `click(tab)`, `toggle`, `openTab(tab)`), and update `checks-panel-state` tests if their contract changes.

## Task 7: Properties in sections

- `Inspector.tsx` keeps its content but lays it out like EasyEDA's Properties: a header line "Selected objects: N" (N is 0 or 1 today); then collapsible sections, each with a 24px header (`--strip`, a chevron, the title) and 32px rows with the label on the left (40% width, `--muted`) and the value control on the right (inputs 24px high, full width of their cell, 1px `--line` border, square corners).
- Sections for a part: **Basic** (name, kind, value fields), **Position** (x, y, rotation, side, lock), **Connections**, **Library** (when it is a library part), **Notes**. The action buttons (rotate, lock, delete) sit in a row under the header. With nothing selected: **Build** and **Notes for the agent**, as today, in the same section style.
- Collapsed sections are remembered per section title while Studio is open (state in the component; no storage).
- Tests: a pure `inspectorSections(part)` that returns the section titles and which rows each holds, so the order is tested without a DOM.

## Task 8: browser check (controller)

Build, open Studio on a copy of `examples/usb-c-ldo`, and check in the browser: the layout boxes match §1's sizes (menu 32, toolbar 32, strips 24, doc tabs 24, bottom strip 24, left 231, right 262); every menu opens, hover switches, Esc closes; every working command does what the menu says; the toolbar buttons work in both documents; the strips collapse and switch; the doc tabs switch views; the bottom tabs open and close and `\` toggles; Properties sections collapse; no dark-on-dark or light-on-light text. Fix what fails before the round ends.
