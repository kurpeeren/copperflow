# Studio UX round 2: the canvas look

Spec: `docs/studio-easyeda-parity.md` (§6 and §10 round 2). Round 1 (`docs/plans/studio-ux-1.md`) gave Studio its EasyEDA-style frame; this round makes the two canvases draw like EasyEDA Pro's default themes.

## Global constraints

The round 1 constraints hold (English, one-line commits with no trailers, no EasyEDA artwork, no "tscircuit" on screen, no new dependencies, styles.css must not grow, small functions and files, logic in tested `.ts` modules, keys work on a Turkish Q keyboard, `npm run typecheck`, `npm test` and `npm run build` pass). Do not change `src/engine/` or `src/core/`.

Facts about the canvases:

- The PCB draws in mm; its palette is `PALETTE` in `studio/src/pcb/ctx.ts`.
- The schematic draws in sheet units, where 1 unit is 1 inch: the grid is 0.1 and box-symbol pins are 0.2 apart (`src/engine/schematic.ts`, `src/engine/symbols/box.ts`). Its colours are at the top of `studio/src/pcb/schematic-draw.ts`.
- Grids, selection boxes and other overlays are in `studio/src/pcb/overlays.ts`.
- Violation rings (`markers.ts`) keep the error and warning colours.

What round 1 left in place:

- The toolbar (`studio/src/shell/toolbar.ts`, `ToolbarRow.tsx`) holds the commands as data; a canvas puts its own controls (the snap select, the PCB layer toggles, Keep, hints) into the toolbar's `#toolbar-view-slot` through a portal.
- Menu items are data in `studio/src/shell/menus.ts`; View → Grid style is `pending` until Task 4 here makes it a command. Menu, toolbar and keys share one command path (`commands.ts`, `use-app-commands.ts`).
- The global `button` rules in `styles.css` (`display: inline-flex`, the generic hover) leak onto new buttons: give any new button explicit hover and pressed rules.

## Task 1: schematic colours

Replace the schematic colours with the spec's §6 schematic table: background `#FFFCF8`; symbol outline `#A00000` with no fill (the body fill becomes transparent); pins `#880000`; pin names and numbers `#000000`; designators and net names `#0000FF`; values `#000080`; wires `#008800`; junctions `#CC0000` (filled dots); net labels as blue text with no box; ground and power flags drawn in `#A00000` with their net name in `#0000FF`; selected objects `#FF0000`; a highlighted net `#FF9933`; the hovered or active pin while wiring `#FF9933`. The schematic grid becomes thin solid lines in `#F0F0EB`, one line per grid step when the step is at least 8px on screen, else one per five steps. Auto-placed boxes and pending previews get colours that read on the light sheet.

Test: a pure `schematicTheme` object exported from one module with these values, and a test that checks each against the spec's table.

## Task 2: drawing border and title block

A drawing border like EasyEDA's around the schematic.

- New pure module `studio/src/pcb/sheet.ts`: `sheetFor(extents)` picks the smallest of A4, A3, A2, A1, A0 landscape (in inches: 11.69×8.27, 16.54×11.69, 23.39×16.54, 33.11×23.39, 46.81×33.11) that holds the drawing's extents plus a 0.5 in margin on each side, and returns its rectangle placed so the drawing is centred on it, snapped to the 0.1 grid. Zones: 6 across × 4 down on A4, scaled with the sheet's size (A3 8×6, A2 12×8, A1 16×12, A0 24×16). Zone labels are 1, 2, 3… across the top and bottom, A, B, C… down the left and right, in a 0.2 in band inside the outer line.
- The title block sits in the bottom-right corner inside the zone band: 4.0 × 1.2 in, with rows for the project (Studio root folder name), the page ("Schematic"), the file name, the date of the build, and "Rev" (empty). Lines `#A00000`, text `#000080`, labels small, values larger.
- The schematic canvas draws the border and title block under everything else. Fit all (`K`) fits the sheet, not just the parts.
- Tests: `test/sheet.test.ts` for the size choice, the centring and snapping, the zone counts and labels, and the title block's rectangle.

## Task 3: PCB colours

Replace `PALETTE` with the spec's §6 PCB table: background `#000000`; no board fill (the board area stays black); board outline `#FF00FF`; top copper `#FF0000`; bottom copper `#0000FF`; plated holes' pads and via rings `#C0C0C0` (multi-layer); holes `#222222`; top silkscreen `#FFCC00`; bottom silkscreen `#66CC33`; courtyards and fabrication outlines as the assembly layers (`#33CC99` top, `#5555FF` bottom); ratsnest `#6464FF`; keepouts hatched in `#F022F0`; a highlighted net drawn in white on top of its layer colour; selection outlined in `#FFFFFF` with a 50% white wash; the selection box dotted `#00FFFF`. The grid is white: minor lines at 30% opacity, every fifth line at 50%.

Test: a test that checks `PALETTE` against the spec's table.

## Task 4: grid style and grid size

- View → Grid style and a toolbar button switch the grid between lines and dots, separately for each document; the dots are 1px squares at the line crossings, in the same colours.
- The snap select becomes a "Grid" select whose step is both the grid and the snap, as EasyEDA links them. PCB steps, in this order: 0.1 mm, 2 mil, 5 mil, 10 mil, 20 mil, 25 mil, 0.5 mm, 50 mil, 1 mm, 100 mil (stored in mm: 0.1, 0.0508, 0.127, 0.254, 0.508, 0.635, 0.5, 1.27, 1, 2.54; sorted by size in the list). EasyEDA's own steps are the mil ones; 0.1, 0.5 and 1 mm stay so today's steps still exist. The default stays 0.5 mm. Each step is labelled in the current unit (`Q` switches mm and mil). Schematic steps: 0.05, 0.1, 0.2 in, default 0.1.
- Move the menu item View → Grid style from pending to a command, and add a Grid style button to both toolbars (spec §4).
- Tests: the step lists and their labels in both units.
- Two small items left from round 1, since this task touches the menus: `menuKey` in `studio/src/shell/menu-keys.ts` returns null when Alt, Ctrl or Meta is held (Tab excepted), so Alt+Left/Right still reach the browser; and a test for `studio/src/shell/key-gate.ts` that pins which keys it holds back while a menu or dialog is open. The build status button's title becomes "Show DRC", since `\` reopens the last bottom tab, not always DRC.

## Task 5: browser check (controller)

Sample the canvases' pixels in the browser: background, grid, wire, symbol, pin, label and junction colours on the schematic; background, outline, copper, silk and ratsnest on the PCB. Check the border and title block, both grid styles and every grid step. Fix what fails before the round ends.
