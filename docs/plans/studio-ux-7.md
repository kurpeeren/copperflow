# Studio UX round 7: a sharp look and our own type

Asked by the user (2026-11-09): the design looks blurry and the fonts look bad; the type may be our own rather than EasyEDA's. Measured in Chrome on the user's screen (Windows display scale 110%, `devicePixelRatio` 1.1): the canvases size their backing store to the device resolution correctly, but grid lines are snapped to CSS pixels (`Math.round(x) + 0.5` in `studio/src/pcb/grid.ts`), so at a ratio of 1.1 every 1px line falls between two device pixels and is drawn as two faint ones (a grid line samples 247,246,241 twice instead of 240,240,235 once). The interface text is EasyEDA's stack, `Arial, "Microsoft YaHei"` at 12px (`--sans` in `studio/src/styles.css`), which Windows renders soft at that size; the canvas text already uses `"Segoe UI Variable Text", "Segoe UI", system-ui` (`CANVAS_FONT_FAMILY` in `studio/src/pcb/ctx.ts`).

## Global constraints

The round 1–6 constraints hold: English in the repo; one-line commits with no trailers; no EasyEDA artwork; no "tscircuit" on screen; no new dependencies (no bundled font files either: system fonts only); `styles.css` must not grow; small functions and files; logic in tested `.ts` modules; `npm run typecheck`, `npm test` and `npm run build` pass. `src/engine/` and `src/core/` stay untouched.

## Task 1: lines on device pixels

- A small pure module (e.g. `studio/src/pcb/crisp.ts`) with the rules: a hairline is one device pixel wide (`1 / ratio` in CSS pixels); a hairline's centre sits in the middle of a device pixel (`(Math.round(v * ratio) + 0.5) / ratio`, or `Math.floor` — pick one and use it everywhere); a filled square of n device pixels starts on a device pixel boundary.
- Use it wherever a canvas draws a thin line or a small square meant to be sharp: the grid on both canvases (lines and dots, the fifth lines too), the drawing border, zone ticks and title block (`sheet-draw.ts`), the selection box, hover and selection outlines (`overlays.ts`), wire handles (`wire-overlay.ts`), the board outline's hairline if it has one. The renderers get the ratio from `prepareCanvas` (`canvas-common.ts`), which already knows it.
- World-scaled strokes (wires, symbol bodies, copper) keep their world widths but never draw thinner than one device pixel.
- Text: canvas labels are placed so their baseline lands on a device pixel row.
- Tests: the helper at ratios 1, 1.1, 1.25, 1.5 and 2 (every hairline centre is k + 0.5 device pixels; widths are one device pixel); the grid plan's line positions at ratio 1.1.

## Task 2: our own type

- The interface uses a system stack that renders sharp on Windows and reads as ours, not EasyEDA's: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif` for text, kept at the frame's sizes (12px chrome, 13px for Properties values and table cells if they are 12px today), with tabular figures (`font-variant-numeric: tabular-nums`) wherever numbers line up: the status line's coordinates, the Grid select, Properties numbers, the Library and Find tables. `--mono` stays for code and ids.
- Canvas text: designators and net names a step bolder than values (600 against 400), values and pin names at their sizes today; the schematic's pin numbers in the mono stack with tabular figures.
- Change the variables, not every rule: `styles.css` must not grow (swap values in place; move a rule to `shell.css` only if needed).
- Tests: a test that the two stacks are what this task says (as round 2's theme tests check colours).

## Task 3: browser check (controller)

On the user's 110% screen in Chrome: sample a grid line across its width on both canvases (one device pixel at the line's full colour), the drawing border, a selection box and a wire handle; read the computed font of the menu bar, a Properties value and the status line; check text at 100% and 125% too (Chrome zoom stands in for the display scale). Fix what fails before the round ends.
