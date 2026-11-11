# Studio: an editor that works like EasyEDA Pro

copperflow Studio should look and behave like EasyEDA Pro's editor, so that someone who knows EasyEDA can use Studio without learning a new layout or new keys. `docs/editor-map.md` lists EasyEDA's menus and workflow. This document fixes the target: the layout, the colours, the panels and the mouse and key behaviour, with the values measured from EasyEDA Pro V3.2.209 on 2026-11-09.

The look is matched by layout, sizes and colours. No EasyEDA code, icons, logos, artwork or names are copied: icons are our own simple SVG drawings, and the product name stays copperflow. Colours are taken as plain values.

## 1. Layout

```
┌ Menu bar 32px: brand · File Edit View Place Design Route Layout Tools Export Settings Help ┐
├ Toolbar 32px: icon buttons for the open document, in groups ────────────────────────────────┤
│▌│ Left panel 231px  │ Document tabs 24px: <file> Schematic | <file> PCB  │ Right panel 262px │▐│
│▌│  sub-tabs:        │                                                     │  Properties /     │▐│
│▌│  Page Net         │                     canvas                          │  Layer / Filter   │▐│
│▌│  Component Object │                                                     │                   │▐│
├ Bottom panel (opens above its tab strip): Library · Log · DRC · Find Results ───────────────┤
└ Bottom tab strip 24px ─────────────────────────────────────────────────────────────────────┘
```

- `▌` is the left vertical tab strip, 24px wide, at the window's left edge: **Project Design** and **Common Library**. Labels run top to bottom, rotated 90°.
- `▐` is the right vertical tab strip, 24px wide, at the window's right edge: **Properties**, **Filter**, and on the PCB also **Layer**.
- Clicking the open tab of a strip collapses its panel; clicking another tab switches the panel. `[`, `]` and `\` toggle the left, right and bottom panels, as today.
- Document tabs replace the Schematic/PCB switch in the top bar. Each tab is 160px wide. The active tab has the accent wash.
- The canvas fills the rest. The area behind it is `#cccccc`.

## 2. Chrome colours and type

| Token | Value | Use |
|---|---|---|
| font | 12px Arial, "Microsoft YaHei", Helvetica, sans-serif | everything |
| text | `#333333` | text |
| muted | `#666666` | secondary text (EasyEDA uses `#999999`, which is too faint to read at 12px on white) |
| disabled | `#999999` | disabled items |
| panel | `#ffffff` | panels, menu bar, toolbar |
| strip | `#f0f0f0` | vertical tab strips, document tab bar, bottom tab strip |
| tab | `#eeeeee` | inactive document tab |
| line | `#d1d1d1` | borders between areas |
| accent | `#1890ff` | active tab marker, focus, primary buttons |
| accent wash | `#e6f7ff` | active document tab, hovered or selected rows |
| behind canvas | `#cccccc` | |
| error | `#f5222d` | |
| warning | `#faad14` | |

Corners are square or 2px. There are no drop shadows except on menus, dialogs and the toast.

## 3. Menu bar

Brand, then the menus. A click opens a menu; while one is open, hovering another title opens that one; Esc or a click outside closes it. Each item shows its shortcut on the right. Items Studio cannot do yet are shown disabled, with a tooltip naming the stage that brings them (see `docs/engine-design.md`), so the menus read like EasyEDA's from the start.

| Menu | Items that work now |
|---|---|
| File | Open circuit file (the file list), Export BOM, Export package |
| Edit | Undo `Ctrl+Z`, Delete `Delete`, Select all `Ctrl+A`, Find `Ctrl+F` |
| View | Fit all `K`, Zoom in, Zoom out, Unit `Q`, Grid style, Left panel `[`, Right panel `]`, Bottom panel `\` |
| Place | Component `Shift+F`, Wire `Alt+W`, Net label `Alt+N`, Ground flag, Power flag |
| Design | Check DRC, Highlight net `H`, Clear highlight `Shift+H` |
| Route | — (stage 4 and 5) |
| Layout | Rotate `Space`, Lock, Unlock |
| Tools | History (opens Log) |
| Export | BOM, Package |
| Settings | — |
| Help | Keys (a list of every shortcut), About |

## 4. Toolbar

One row of 24px icon buttons with tooltips (`Name (key)`), split into groups by 1px separators. The row changes with the open document.

- Both: Undo · Zoom in, Zoom out, Fit all · Grid style, Snap, Unit (PCB) · Check DRC
- Schematic: Component, Wire, Net label, Ground, Power · Rotate
- PCB: Rotate · Layer toggles move to the Layer panel

## 5. Panels

**Left: Project Design.** Sub-tabs across the top, as EasyEDA:

- Page: the project tree. Project folder → each circuit file → Schematic and PCB. Clicking Schematic or PCB opens that document tab.
- Net: today's net list, with highlight.
- Component: today's Parts tree.
- Object: wires and connections, and marks.

**Left: Common Library.** Today's Library list and search.

**Right: Properties.** A header line "Selected objects: N". Below it, collapsible sections with a 24px header (`#f0f0f0`) and 32px rows: the label on the left (fixed 40% width), the value control on the right. Today's Inspector content is split into sections: Basic (name, kind, value), Footprint, Position, Connections, Library, Notes.

**Right: Layer** (PCB). One row per layer: colour swatch, name, eye toggle. Filters All / Copper / Non-copper. It replaces the layer buttons in the canvas toolbar.

**Right: Filter.** Checkboxes for which object kinds a click can select: parts, wires, net labels, marks.

**Bottom.** A 24px tab strip at the bottom edge with Library, Log, DRC and Find Results. Clicking a tab opens the panel (240px) above the strip, or closes it when it is the open one.

- Library: a table (Name, Value, Footprint, Description, Verified) with a search field; double-click or Place puts the part on the board.
- Log: today's History, with undo.
- DRC: today's Checks panel.
- Find Results: what `Ctrl+F` found.

## 6. Canvas colours

**Schematic** (EasyEDA's default light theme):

| Item | Colour |
|---|---|
| background | `#FFFCF8` |
| grid | `#F0F0EB` |
| wire, bus | `#008800` |
| junction | `#CC0000` |
| symbol outline | `#A00000`, no fill |
| pin | `#880000` |
| pin name, pin number | `#000000` |
| designator, net name | `#0000FF` |
| value and other properties | `#000080` |
| no-connect flag | `#33CC33` |
| selection | `#FF0000` |
| highlight | `#FF9933` |
| drawing border, title block | `#A00000` lines, `#000080` text |

The sheet has a drawing border with zone labels (1, 2, 3… across, A, B, C… down) and a title block in the bottom-right corner: project, page, file, date. The sheet is A4 landscape, or the next standard size up that holds the drawing.

**PCB** (EasyEDA's default theme):

| Layer or item | Colour |
|---|---|
| background | `#000000` |
| top copper | `#FF0000` |
| bottom copper | `#0000FF` |
| top silkscreen | `#FFCC00` |
| bottom silkscreen | `#66CC33` |
| top solder mask | `#800080` |
| bottom solder mask | `#AA00FF` |
| top paste | `#808080` |
| bottom paste | `#800000` |
| top assembly | `#33CC99` |
| bottom assembly | `#5555FF` |
| board outline | `#FF00FF` |
| multi-layer (plated holes) | `#C0C0C0` |
| document | `#FFFFFF` |
| hole | `#222222` |
| ratline | `#6464FF` |
| grid | `#FFFFFF` at 30% |
| selection box, cursor | `#00FFFF`, dotted |

## 7. Mouse

- Wheel zooms about the pointer.
- Right-button drag pans. A right click without movement opens the context menu.
- Left click selects; Shift or Ctrl + click adds to or removes from the selection.
- Left drag on an empty spot draws a selection box. Left to right selects what is fully inside; right to left selects what it touches.
- Left drag on a selected part moves the whole selection.
- Double click on a part opens its properties; on a net label it renames the net.
- Hovering a part or a wire outlines it.

### 7.1 Schematic wires

What EasyEDA Pro does, from its guide's wire, hotkey and settings pages and a check in its example project (V3.2.209):

- Wire (`Alt+W`): click to start, click to place corners, end on a pin, label or wire. `Space` flips the path's bend while drawing, `Backspace` steps back, `Esc` or a right click cancels.
- One click on a wire selects one segment, a second click the whole wire, and `Tab` switches between them. The selected wire turns red and Properties shows a Wire section (net, colour, width, style).
- Dragging a wire reshapes it. Moving a part keeps its wires attached (the "wire follows" setting, on by default).
- `Delete` removes the selected wire.

What Studio does:

- A wire is one trace's path from its first end through its corners (`schematicRouteHints`) to its last end, or a wire Studio draws on its own between two pins of a named net.
- The wire saved is the wire previewed while drawing: every segment horizontal or vertical. `Space` flips the bend of the leg to the pointer.
- A click on a wire selects the whole wire, drawn red, with square handles on its corners. A selection holds parts and wires together: Shift or Ctrl + click adds or removes a wire, a box takes wires by the same direction rule as parts, `Ctrl+A` takes every part and wire, and Delete and dragging act on all of it. Its ends sit on pins and labels and do not move: a trace always joins two things, so a wire end cannot be left loose, and one segment cannot be deleted on its own.
- Dragging a segment moves it across its own direction, and its neighbours stretch to stay attached. A segment that ends on a pin or label gets a new short segment there, so it never leaves the pin. Dragging a corner handle moves the corner, and both its segments stay horizontal or vertical. A double click on a corner handle removes the corner. A double click elsewhere on a wire opens Properties on its Wire section.
- Dragging a wire Studio drew on its own turns it into a trace of its own between its two pins, with the new shape.
- `Delete` removes the selected wire's trace. A wire Studio drew on its own has no trace to delete, and says so.
- Moving parts (dragging, arrow keys, align and distribute) keeps the first segment of each of their wires horizontal or vertical, in the same history entry.
- Hovering a wire outlines it. The Filter tab has a Wires row. The context menu on a wire has Properties, Highlight net, Remove corners and Delete.

## 8. Keys

All of `docs/editor-map.md` §2's keys, plus: `Ctrl+Z` undo, `Delete` delete, `Ctrl+A` select all, `Esc` clears the selection and puts tools away, arrow keys nudge the selection one grid step (`Shift` for ten), `Ctrl+F` find. Our own keys (`W`, `R`, `F`) keep working beside them. Keys go by the character they produce, so they work on a Turkish Q keyboard; Alt combinations go by the physical key.

## 9. Context menu

On a part: Properties, Rotate, Lock or Unlock, Highlight its nets, Delete. On empty canvas: Fit all, Grid style, Paste (disabled until copy exists). It closes with Esc or a click elsewhere.

## 10. Order of work

Each round ends with tests passing, a check in the browser and a commit.

1. **Shell.** Light chrome, menu bar, toolbar, vertical tab strips, document tabs, the bottom tab strip, Properties sections. The existing panels move into their new places.
2. **Canvas look.** The schematic and PCB colours, the drawing border and title block, grid style.
3. **Mouse and keys.** Right-drag pan, context menu, multi-selection with box select, arrow nudge, select all, find.
4. **Panels in depth.** Layer manager, Filter, the Library table, Find Results.
5. **Then:** whatever a side-by-side comparison with EasyEDA still shows, and the items that waited on the engine (flip, copy and paste, routing).
6. **Wires.** Drawing, selecting and reshaping schematic wires as in §7.1.
7. **The last menu items (done).** Every menu item now runs; none is shown disabled as still to come. Each one that changes the design writes through `src/core` as one history entry, and locked parts are left as they are and named:
   - File → **New circuit…**: a dialog for the name and board size; the server writes an empty `<name>.circuit.tsx` through the core (`createCircuitFile`), Undo removes it, and the Studio opens it.
   - File → **Print…** and Export → **PDF…**: every schematic page (light theme) and the board, drawn by the canvases' own renderers, one A4 landscape SVG sheet each with a title line, printed by the browser; PDF is the print dialog's "Save as PDF" (no PDF library).
   - Edit → **Copy** (`Ctrl+C`) and **Paste** (`Ctrl+V`, also on the canvas's context menu): the selected parts with their literal props and pin labels, and the traces among them or to named nets; pasted with the lowest free designators (sub-sheet instance parts count as taken), the copy's middle at the pointer in the view pasted in, and stepped further for each paste without a pointer, on the open schematic page. A library part's import comes along into a circuit in the same folder; from another folder the paste is refused with the import named. Props written as expressions and sub-sheet instances are named and left out.
   - Edit → **Find similar objects** (`Ctrl+Shift+F`): selects the parts of the same kind, footprint and value as the selected one, or the drawings, pours or holes of its kind.
   - Place → **No connect flag**: a tool that flags the pin end clicked (the part's `noConnect` prop); the engine's ERC skips pin-unconnected for it and reports one wired anyway; the sheet draws a cross. A second click takes the flag off.
   - Place → **Junction** (`Alt+J`): a tool that puts a `<junction>` dot on the wire clicked, on that wire's page; it is a drawing, so it selects, moves and deletes as one. It is not tied to the wire: moving or deleting the wire leaves the dot where it was.
   - Design → **Annotate designators**: every part renumbered by where its symbol sits (page, then top to bottom, then left to right), every reference following (trace ends, instance connections, pour and layout-file net ids, worked out from the built design) in one history entry with the layout file; a reference that cannot be rewritten safely refuses the whole rename; locked parts keep their numbers.
   - Design → **Placement transfer** (`Ctrl+Shift+X`): the selected PCB parts (or all) placed in their schematic arrangement, scaled, each page in its own region, turned as their symbols, about where they are now.
   - Route → **Routing corner** (`L`): steps the corner mode 45°, 45° reversed, 90°, arc, for the leg being drawn and the routes after it.
   - Layout → **Flip** (`X`): the selected parts to the other side (`layer="bottom"`, mirrored by the engine, exported on the bottom in the Gerbers and pick-and-place).
   - Tools → **Footprint manager…**: every part with its kind, value and footprint; changed footprints are written together. Library parts, expressions and locked parts say why they cannot change here.
   - Settings → **System…**: theme, PCB unit, each document's starting Grid step and hover labels, kept per browser.

## 11. Out of scope here

Board outline and Copper area on the PCB toolbar still wait on hand routing (stage 4) and stay disabled with that reason. Copy and Paste keep their own clipboard inside the Studio tab (parts and their traces, not PCB copper, schematic drawings or sub-sheet instances), and do not carry an import across folders. A junction stays where it was put when its wire moves. Print sheets carry the drawing as an image, so text in the PDF is not selectable.
