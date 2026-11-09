# Studio UX round 3: mouse and keys

Spec: `docs/studio-easyeda-parity.md` (§7, §8, §9 and §10 round 3). Rounds 1 and 2 (`docs/plans/studio-ux-1.md`, `studio-ux-2.md`) gave Studio EasyEDA's frame and canvas look; this round makes the mouse, the selection and the keys work like EasyEDA Pro's.

## Global constraints

The round 1 and 2 constraints hold: English in the repo; one-line commits with no trailers; no EasyEDA artwork; no "tscircuit" on screen; no new dependencies; `styles.css` must not grow (a test caps it at its current length); small functions and files; logic in tested `.ts` modules; keys go by the character they produce (Turkish Q keyboard), Alt combinations by the physical key; `npm run typecheck`, `npm test` and `npm run build` pass. Do not change `src/engine/` or `src/core/`.

Facts:

- Today the selection is one part name (`selected: string | null`), passed from `studio/src/App.tsx` (through the hooks and the `Workspace` component made in round 1) to the left panel, the Inspector (Properties) and both canvases.
- Gestures are in `studio/src/pcb/use-canvas-gestures.ts`: middle or right drag pans, Shift-drag draws a note box (marks for the agent), a press on a part selects and drags it, and a left press on empty canvas pans.
- Edits go through `actions.edit(edits, summary)`, which takes several edits at once, so a multi-part move is one change in the history.
- Locked parts cannot move (`blockerFor`).
- Menu items, toolbar buttons and keys share one command path (`studio/src/shell/commands.ts`, `use-app-commands.ts`, `command-owners.ts`).
- The bottom panel has a Find Results tab with a placeholder (`studio/src/shell/BottomPanel.tsx`).
- The built-in browser pane is hidden at night, so canvases never draw there; the controller checks canvases in Chrome.

## Task 1: selection as a set

- New pure module `studio/src/selection.ts`: `Selection` is an ordered list of part names with `only(name)`, `toggle(name)`, `add(names)`, `clear()`, `all(names)`, `has(name)`, `primary` (the last one picked).
- Replace `selected: string | null` everywhere with the selection. A click selects one; Shift+click or Ctrl+click toggles one in or out (EasyEDA uses both).
- Properties: the header shows "Selected objects: N". With one part, today's sections. With several: a "Selection" section listing the names, and the actions that apply to all (Rotate, Lock, Unlock, Delete), each one change in the history.
- The left panel's Component tree highlights every selected part; Ctrl+click in the tree toggles.
- `Esc` clears the selection. `Ctrl+A` selects every part of the open document (Edit → Select all stops being pending).
- Tests: the selection helpers; the Properties sections for N = 0, 1, 3.

## Task 2: EasyEDA's mouse

- A left drag on empty canvas draws a selection box instead of panning. Left to right (solid outline) selects the parts fully inside; right to left (dashed outline) selects the parts it touches. With Shift or Ctrl held, the box adds to the selection. Colours: the PCB's selection box is the cyan dotted box of round 2; the schematic's is `#0000FF`.
- Right drag pans (middle drag too). A right press that moves less than 3px and is released opens the context menu (Task 3) instead.
- A left drag on a selected part moves the whole selection; locked parts in it block the move with today's message. The move is one `actions.edit` call.
- The note box moves off Shift-drag: Place → Note box arms it, then a left drag draws the box, as today's Shift-drag did.
- Double click on a part opens the right panel on Properties and focuses its first editable field. Double click on a net label starts renaming it with the label's name input.
- Hovering a part outlines it (today's hover look), in both views.
- Tests: the gesture start rules as a pure function (button, modifiers, what is under the pointer → gesture kind), box selection by direction, and the group move's edits.

## Task 3: context menu

- New `studio/src/shell/context-menu.ts` (items as data, per target) and `ContextMenu.tsx`, drawn like the menu bar's dropdowns (same CSS) at the pointer, kept inside the window.
- On a part (it joins the selection if it was not in it): Properties, Rotate (Space), Lock or Unlock, Highlight its nets (H), Delete (Delete). On empty canvas: Fit all (K), Grid style, Zoom in, Zoom out, Paste (pending: "Comes with the engine (stages 3 to 5)"). On a net label (schematic): Rename, Highlight net.
- Items run the same `CommandId`s as the menu bar. Esc, a click elsewhere, or running an item closes it. Arrow keys move through it, as in the menu bar.
- Tests: the items for each target; placement inside the window.

## Task 4: keys

- Arrow keys move the selection one grid step (the Grid select's step); Shift+arrow moves ten steps. Locked parts block, as dragging does. One history entry per key press.
- `Delete` deletes the whole selection; `Space` (and `R`) rotates the whole selection about its centre, snapped to the grid; one history entry each.
- `Ctrl+F` opens Find (Task 5).
- Every new key shows in Help → Keys and in the menus. Keys never fire while typing in a field, a menu is open or a dialog is open (the round 1 key gate).
- Tests: the key map entries; the nudge and group-rotate edits.

## Task 5: Find

- `Ctrl+F` (and Edit → Find) opens a small find box at the top right of the canvas: one text field, Enter to search, Esc to close.
- It matches part names, values and footprints, and net names, case-insensitively, as substrings.
- The results go to the bottom panel's Find Results tab (which opens): one row per hit with its kind (Part or Net), its name and what matched. Clicking a part row selects the part and centres it, as the DRC rows do; clicking a net row highlights the net.
- Tests: the matcher; the rows.

## Task 6: browser check (controller)

In Chrome (the built-in pane does not draw canvases at night): box selection both ways, Shift/Ctrl+click, group move and its single history entry, right-drag pan, the context menu on a part, on empty canvas and on a net label, double click to Properties, arrow nudge, Ctrl+A, Delete, group rotate, Find and its results. Fix what fails before the round ends.
