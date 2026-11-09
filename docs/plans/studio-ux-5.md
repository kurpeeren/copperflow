# Studio UX round 5: the side-by-side pass

Spec: `docs/studio-easyeda-parity.md` (§3, §4, §10 round 5). Rounds 1–4 gave Studio EasyEDA Pro's frame, canvas look, mouse, keys and panels. This round compares Studio with EasyEDA's own menus and toolbars (measured from EasyEDA Pro V3.2.209, see `docs/editor-map.md` §3 and the toolbar lists below) and builds what Studio can do without the engine's later stages. Items that need blocks, routing or fabrication outputs stay pending with their stage named.

EasyEDA's toolbars, as measured:

- Schematic: Board · Open Project, Save, Save All, Backup · Undo, Redo · Common, Arrays · Find Similar Objects · Zoom In, Zoom Out, Fit All in Window (K), Fit Selection View, Fit Area Selection View · Grid Style, Grid Size, Unit (inch / mm), Snap (Alt+S) · Component (Shift+F), Resistor, Wire (Alt+W), Bus (Alt+B), Net Label (Alt+N), Short Flag, VCC, IN, No Connect Flag, Junction Flag (Alt+J), Differential Pairs Flag, Test Point · Mask Region, Polyline (Alt+L), Arc (Alt+A), Bezier (Alt+Z), Circle (Alt+C), Ellipse (Alt+E), Rect (Alt+R), Text (Alt+T), Image, Table · Update/Convert Schematic to PCB (Alt+I), Generate/Update Block Symbol · Align Left (Ctrl+Shift+L), Align Right, … · Distribute …
- PCB: Board · Open Project, Save, Save All, Backup · Undo, Redo · Common, Arrays · Find (Ctrl+F) · 2D Preview, 3D Preview · Fit Area Selection View · Flip Board · Brightness, Inactive Layer modes · Unit (mil / mm) · Grid Style · Pad (Alt+P), Via, Board Outline, Copper Area, Fill Region, Slot Region, Prohibited Region, Polyline (Alt+L), Text, Length (Alt+N) · Import Changes from Schematic (Alt+I) · Check DRC · Single Routing, Stretch Track (Shift+W), Routing Corner · Align Left (Ctrl+Shift+L), Distribute Horizontally (Ctrl+Shift+H) · Rotate Left (Space), Rotate Right · Gerber, Pick and Place, Order PCB.

## Global constraints

The round 1–4 constraints hold: English in the repo; one-line commits with no trailers; no EasyEDA artwork; no "tscircuit" on screen; no new dependencies; `styles.css` must not grow; small functions and files; logic in tested `.ts` modules; keys by character (Turkish Q keyboard), Alt combinations by physical key; canvas keys follow the key-ownership rules R32–R34; `npm run typecheck`, `npm test` and `npm run build` pass. `src/engine/` stays untouched. `src/core/` may change only for Task 1's redo, with the lock rules kept.

## Task 1: Redo

- `src/core/workspace.ts` gets `redoChange(root, { author, id? })`: it re-applies the newest undone change (or the one named), only if the file still matches what the undo left, only if no locked part would change, and writes a history entry "Redo: <summary>" with `redoOf` set. An undo of a redo works like any undo. The agent's MCP tools do not get redo in this round.
- The Studio server gets `POST /api/redo`; Edit → Redo (`Ctrl+Y`, and `Ctrl+Shift+Z`) runs it; the toolbar gets a Redo button beside Undo; the Log marks redone entries.
- Tests: core redo (the newest undone change; a named one; refused when the file changed, when a locked part would change, when nothing is undone); the server endpoint; the key map.

## Task 2: align and distribute

- Layout → Align left, Align right, Align top, Align bottom, Align horizontal centres, Align vertical centres, Distribute horizontally, Distribute vertically. Align left is `Ctrl+Shift+L` and Distribute horizontally `Ctrl+Shift+H`, as in EasyEDA; the others have no key.
- They act on the selection (two or more parts for align, three or more for distribute; otherwise disabled with the reason) in the open view, by each part's bounding box, snapped to the open view's Grid step, in one history entry through the shared move path; locked parts are skipped and named.
- A toolbar group with Align left and Distribute horizontally (as EasyEDA's toolbar shows), the rest in the menu and the context menu on a multi-selection.
- Tests: the eight layouts as pure functions; the enabled rules; locked members.

## Task 3: view tools

- View → Fit selection (and toolbar): fits the camera to the selection's bounding box; disabled with nothing selected.
- View → Fit area (and toolbar): arms a one-shot tool; the next left drag draws a box and the camera fits it; Esc puts the tool away.
- Layout → Rotate right (and toolbar, beside Rotate): rotates the selection 90° clockwise about its centre through the same path as Rotate (Space); no key.
- Snap (`Alt+S`, View → Snap, toolbar toggle): off means drags and nudges move freely (no grid snap, still rounded to 4 decimals); the status line shows "Snap off" while it is off.
- Tests: the fit maths, the area tool's states, rotate right's edits, snap on/off in the move path.

## Task 4: toolbar and menu parity

- Reorder both toolbars into EasyEDA's groups (above), with Studio's buttons where EasyEDA has them, and add disabled buttons, with the stage named, for the EasyEDA tools that need later stages: on the schematic Bus, No connect flag, Text; on the PCB Via, Single routing, Board outline, Copper area, Gerber. Keep the toolbar to one row at 1280 px (group overflow into a "More" menu if needed).
- Menu items that say "Comes in round 5" get either a working command or an honest pending reason that names what they wait for: Settings → Hotkeys opens the Keys dialog; Tools → Footprint manager, Design → Design rules, Annotate designators, Place → Text/Junction/No connect flag name their real stage or say they come later.
- Tests: toolbar order per view; every pending button has a reason; no menu item mentions "round 5".

## Task 5: browser check (controller)

In Chrome: Redo after Undo (and the Log), align and distribute on three parts in both views, fit selection and fit area, rotate right, snap off and on, both toolbars at 1280 px with no overflow, the pending buttons' tooltips. Fix what fails before the round ends.
