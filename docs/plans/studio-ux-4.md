# Studio UX round 4: panels in depth

Spec: `docs/studio-easyeda-parity.md` (§5 and §10 round 4). Rounds 1–3 (`docs/plans/studio-ux-1.md` … `studio-ux-3.md`) gave Studio EasyEDA's frame, canvas look, mouse, selection, keys and Find. This round fills the right strip's Layer and Filter tabs and turns the bottom Library tab into a table.

## Global constraints

The round 1–3 constraints hold: English in the repo; one-line commits with no trailers; no EasyEDA artwork; no "tscircuit" on screen; no new dependencies; `styles.css` must not grow; small functions and files; logic in tested `.ts` modules; keys by character (Turkish Q keyboard); `npm run typecheck`, `npm test` and `npm run build` pass. Do not change `src/engine/` or `src/core/`.

Facts:

- The right side strip (`studio/src/shell/SideStrip.tsx`, state in `studio/src/use-workspace.ts` as a generic per-side strip state since round 1) has only Properties today; adding a tab is adding a `RightStrip` value.
- PCB layer visibility lives in the PCB canvas today (the toolbar slot's "Show or hide top / bottom / silk / courtyard" toggles); PCB colours are `PALETTE` in `studio/src/pcb/ctx.ts`.
- Selection is a set of part names (`studio/src/selection.ts`); since round 3's last fix one shared "can pick" check decides what a click or a box picks — the Filter plugs in there.
- Layer visibility is local to the PCB canvas and hit tests ignore it: Task 1 lifts it into workspace state and makes hidden layers unpickable.
- The bottom panel's Library tab shows today's Library list (`studio/src/Library.tsx`); the left Common Library strip shows the same list.

## Task 1: Layer panel (PCB)

- A **Layer** tab in the right strip, shown only while the PCB is open (EasyEDA shows it only on the PCB).
- One 28px row per layer the PCB draws: Top Layer, Bottom Layer, Top Silkscreen, Bottom Silkscreen, Top Assembly, Bottom Assembly, Board Outline, Multi-Layer, Hole, Ratline (and Keepout if keepouts exist). Each row: a 12×12 colour swatch from `PALETTE`, the name, an eye toggle on the right.
- Filters at the top: All, Copper, Non-copper (segmented buttons).
- Visibility moves from the PCB canvas into workspace state (per file is not needed; per Studio session), and the toolbar slot's layer toggles go (the panel replaces them).
- Tests: the layer list and its groups; visibility state; what each layer hides in the draw (a recorded-draw test that a hidden Top Layer draws no #FF0000).
- Hidden layers cannot be picked: a click or a box ignores parts whose only drawn layers are hidden (through the shared can-pick check).
- Left from round 3: the held-rotate gate (`studio/src/pcb/key-burst.ts`) compares the browser clock with the server's build start; release it on a new build id after the send instead (no clock compare), keep it closed after a failed build until a successful one, and show "Waiting for the build…" in the status line while a rotate is held. Tests.

## Task 2: Filter

- A **Filter** tab in the right strip, in both views: checkboxes for what a click or a box can pick: Parts, Net labels and flags (schematic), Notes. All on by default.
- Box select and click honour it (pure rule in `press.ts`/box selection, tested); a filtered-out kind still draws and can still be reached from the left panel.
- Tests: the filter rule for click and box.

## Task 3: Library table

- The bottom panel's Library tab becomes a table: Name, Value (the starting value), Footprint, Description, Verified (a badge), with a search field over it that filters all columns.
- Double click on a row, or its Place button, places the part as the Library list does today.
- Columns resize to the panel width; the table scrolls inside the 240px panel with a sticky header.
- Tests: the rows and the filter.

## Task 4: browser check (controller)

In Chrome: Layer tab only on the PCB, each eye hides its layer (pixel check), filters; Filter checkboxes block clicks and boxes; Library table search, double click and Place. Fix what fails before the round ends.
