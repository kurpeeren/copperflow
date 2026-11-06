# Editor map: EasyEDA Pro and copperflow Studio

This document maps EasyEDA Pro's editor and its usual workflow onto copperflow Studio. The aim is for people coming from EasyEDA to find what they expect in copperflow. Each gap is placed in the engine stage where it belongs (see `docs/engine-design.md`).

Source: EasyEDA Pro V3.2.209, the "Example_Quick Start" project, observed 2026-11-06. It covers the menus, toolbars, panels and the example's own process notes. No EasyEDA code, icons or artwork are used.

## 1. EasyEDA Pro layout

```
┌ Top menu: File Edit View Place Design Layout/Route Tools Export Advanced Settings Help ─┐
├ Toolbar (changes with the document: schematic or PCB) ───────────────────────────────────┤
│ Left panel          │ Document tabs: Start Page | P1.Schematic | PCB   │ Right panel        │
│  Page (project tree)│                                                  │  Properties        │
│  Net                │                 canvas                           │  (selection/page)  │
│  Component          │      + Floating Tool (power flags, ports,        │  Filter            │
│  Object             │        labels, no-connect)                       │  PCB: Layers       │
│ (All Projects,      │                                                  │                    │
│  Common Library)    │                                                  │                    │
├ Status bar: X Y dX dY · zoom % · grid · snap · unit ──────────────────────────────────────┤
└ Bottom panel: Library | Log | Device Standardization | DRC | Find Results | Property List ┘
```

- **Project tree:** Project → Board → Schematic (several sheets) + PCB. Several documents can be open as tabs at once.
- **Panel keys:** `[` toggles the left panel, `]` the right panel and `\` the bottom panel. The bottom panel holds the part library search.
- **PCB right panel:** a layer manager with layers grouped as Top side, Bottom side, Other, Component and 3D shell. Each layer has a colour and a visibility toggle, plus All / Copper / Non-copper filters.

## 2. Workflow, as EasyEDA's own example describes it

**Schematic**
1. Place a device: `Shift+F`, or drag it from the bottom library (`\`).
2. Wire pins: `Alt+W`.
3. Add electrical names with net labels (`Alt+N`) and VCC/GND flags. `Tab` renames a label while placing it, and a double click renames it afterwards. A short flag joins two nets.
4. Edit: `Space` rotates, `X`/`Y` flip, `H` highlights a net and `Shift+H` clears the highlight. The mouse wheel zooms and `K` fits the window.
5. Set rules under Design → Design Rule, then check them with Design → Check DRC.
6. Send the design to the board with Design → Update/Convert Schematic to PCB (`Alt+I`).

**PCB**
1. Bring the parts over with Import Changes from Schematic (`Alt+I`). Draw the board outline.
2. Place parts. Layout offers Auto Component Placement, Group, Align, Distribute and Flip to Opposite Side.
3. Route: single routing `Alt+W`, differential pair `Alt+D`, stretch track `Shift+W`, routing corner style `L`, via `Alt+V`, routing width. Fanout and auto routing are also available.
4. Add copper regions, fill, slot and keepout ("prohibited") regions, and dimensions.
5. Check with Check DRC, Real-Time DRC and Check DFM.
6. Export Gerber, the pick-and-place file (CPL) and the BOM, then order.

**Between the two editors**
- Cross probe (`Shift+X`) selects the same part in the schematic and on the board.
- Placement Transfer (`Ctrl+Shift+X`) places the board parts the way they are arranged in the schematic.

## 3. Menus seen (schematic unless marked)

| Menu | Items |
|---|---|
| File | New, Open Project `Ctrl+O`, Save `Ctrl+Shift+S`, Save All `Ctrl+S`, Save as, Version Control, Historical Records, Projects Backup, Recycle Bin, Import, Export, Print, Recent Projects |
| Edit | Undo `Ctrl+Z`, Redo `Ctrl+Y`, Repeat `F4`, Copy, Copy as Image, Cut, Paste, Move, Delete, Snap `Alt+S`, Select Objects, Array Objects, Find and Replace `Ctrl+F`, Find Similar Objects `Ctrl+Shift+F` |
| View | Zoom In/Out, Fit All `K`, Fit Selection, Fit Area, Full Screen `F11`, Unit `Q`, Grid Size, Grid Type, Highlight Net, Top Toolbar, Left `[` / Right `]` / Bottom `\` panels, Window Arrangement, Floating Tool, Assembly Variant View `Shift+M` |
| Place | Device/Reuse Block `Shift+F`, Wire `Alt+W`, Bus `Alt+B`, Net Label `Alt+N`, Short Flag, Net Flag, Net Port, Off Page Connector, No Connect Flag, Junction `Alt+J`, Differential Pairs Flag, Test Point, Reuse Block, Polyline/Arc/Bezier/Circle/Ellipse/Rectangle/Text/Image/Table |
| Design | Update/Convert Schematic to PCB `Alt+I`, Import Changes from PCB, Generate/Update Block Symbol, Design Rule, Check DRC, Annotate Designator, PCB Design Rule, Cross Probe `Shift+X`, Placement Transfer `Ctrl+Shift+X`, Net Class / Differential Pair / Equal Length Group managers, Update Project Library, Update Reuse Block |
| Layout | Group, Property Location, Align, Distribute, Rotate, Flip, Level |
| Tools | Log, Footprint Manager `Alt+F`, Device Manager, Device Standardization, Assembly Variants, Netlist Comparison, Schematic Comparison |
| Export | Order Parts, Order PCB Layout, BOM, DXF, PDF, PNG, SVG, Netlist, Altium Designer, PADS |
| Advanced | Run Script, Script List, Extensions Manager |
| Settings | System, Schematic/Symbol, PCB/Footprint, Panel, Font, Drawing, Property, Hotkey, Top Toolbar |
| PCB Place | Device `Shift+F`, Via `Alt+V`, Suture Vias, Via Fence, Pad `Alt+P`, Board Outline, Copper / Fill / Slot / Prohibited / Constraint Region, Line, Test Point, Text, Image, Dimension, Stack Table, Drill Table, Canvas Origin, 3D shell items |
| PCB Design | Import Changes from Schematic `Alt+I`, Update PCB to Schematic, Design Rule, Check DRC, Check DRC (Custom), Clear Errors, Real-Time DRC, Check DFM, Board Shape, Annotate Designator, Cross Probe, Net Class / Differential Pair / Equal Length / Pad Pair managers |
| PCB Route | Single Routing `Alt+W`, Differential Pair `Alt+D`, Multiple Routing, Stretch Track `Shift+W`, Gloss Selected Track, Equal Length Tuning `Shift+A`, Fanout, Auto Routing, Routing Mode `Shift+R`, Routing Corner `L`, Routing Width, Remove Loop, Unroute |
| PCB Layout | Auto Component Placement, Group, Property Location, Swap Location, Flip to Opposite Side, Offset, Align, Distribute, Rotate, Flip |

## 4. Map onto copperflow

Legend: ✅ there today · ◐ partly · ✗ missing. "Stage" is where the engine design puts the item.

| Area | EasyEDA | copperflow Studio today | Stage |
|---|---|---|---|
| Project tree | Project → Board → sheets + PCB | One file selector; no sheets | ◐ — stage 3 (hierarchical sheets, block tree) |
| Documents | Tabs for each sheet and the PCB | Schematic/PCB tabs for one circuit | ◐ — stage 3 |
| Left panel | Page, Net, Component, Object | Parts, Library, Wires, History | ◐ — **add a Net tab** (net list with highlight) now |
| Right panel | Properties of the selection or the page | Inspector with editable props, BOM, notes | ✅ |
| Bottom panel | Library, Log, DRC, Find Results, Property List | Library is a left tab; build errors in the Inspector | ◐ — stage 2: **DRC list in a bottom panel** |
| Status bar | X/Y, dX/dY, zoom, grid, snap, unit | Coordinates at the bottom left; snap select | ◐ — add zoom %, unit toggle (`Q`), dX/dY |
| Place a part | `Shift+F` dialog, bottom library | Library tab, Place button | ◐ — add the `Shift+F` shortcut and search |
| Wire | `Alt+W` | `W` and the Wire pins button | ✅ — also accept `Alt+W` |
| Net label / power flags | `Alt+N`, VCC/GND flags, floating tool | Labels come from the engine; dragging moves them (8b0252b) | ◐ — **add Place → Net label / GND / VCC** that writes `pin → net.X` |
| Rename a net while placing | `Tab`, double click | Not yet | ✗ — with the item above |
| Rotate / flip | `Space` / `X` `Y` | `R` rotates; no flip | ◐ — accept `Space`; add `X`/`Y` once the model supports mirroring |
| Highlight a net | `H`, `Shift+H` | Pad hover highlights a net on the PCB | ◐ — add `H` in both views |
| Fit | `K` | `F` and the Fit button | ✅ — also accept `K` |
| Panels | `[` `]` `\` | Fixed | ✗ — cheap to add |
| Find | `Ctrl+F`, Find Similar | Not yet | ✗ — stage 2 |
| Align / distribute | Toolbar and Layout menu | Not yet | ✗ — stage 3 (block layout needs it) |
| Annotate designators | Design → Annotate | The engine reports duplicates; placement picks the next free name | ◐ |
| Design rules | Design Rule dialog, net classes | `rules.yaml` planned | ✗ — stage 2 (`rules.yaml` + a Rules panel) |
| DRC | Check DRC, Real-Time DRC, DFM | Engine diagnostics only | ◐ — stage 2 (live checks were already the plan) |
| Schematic → PCB | `Alt+I` Update/Convert | Not needed: one model, always in step | ✅ (by design) |
| Cross probe | `Shift+X` | Same selection in both views | ✅ — the selection is shared |
| Placement transfer | `Ctrl+Shift+X` | Auto-placement packs around the board centre | ✗ — **fits the block-by-block workflow**; stage 3 |
| Reuse block / block symbol | Reuse Block, Generate Block Symbol | Blocks and instances designed | ✗ — stage 3 |
| Layer manager | Grouped layers, colours, eye, filters | Top / Bottom / Silk / Courtyard toggles | ◐ — stage 4, when copper and 4 layers arrive |
| Routing | `Alt+W` single, `L` corner, `Alt+V` via, `Shift+W` stretch, width | Ratsnest only | ✗ — stage 4 (by hand), stage 5 (router) |
| Regions | Copper, fill, slot, keepout, outline | Board outline from TSX | ✗ — stages 2–4 |
| Auto routing / fanout | Route menu | Planned on request | ✗ — stage 5 |
| Outputs | Gerber, CPL, BOM, PDF/SVG, order | BOM and package | ◐ — stage 6 |
| History | Historical Records, Version Control | History + undo for every change | ✅ |
| Scripts | Run Script, Extensions | Code-first files and MCP for the agent | ✅ (different approach) |

## 5. What to do next, in order

1. **Now, small:** add EasyEDA's shortcuts alongside ours: `Alt+W`, `Space`, `K`, `H`/`Shift+H`, `Q`, and `[` `]` `\` for the panels. Add a Net tab in the left panel. Add the zoom % and the unit toggle to the status bar.
2. **Now, medium:** Place → Net label / GND / VCC from a small floating palette, with `Tab` to name the net. It writes `pin → net.X` with the label at the click point, the same rule label dragging uses.
3. **Stage 2:**
   - a bottom panel with a DRC list that jumps to each violation;
   - a Rules panel backed by `rules.yaml` (net classes, clearances);
   - Find (`Ctrl+F`).
4. **Stage 3:**
   - a project tree with sheets and blocks, and document tabs;
   - Align/Distribute;
   - Placement transfer: board parts placed block by block as they are grouped in the schematic. This is the workflow the maintainer described.
5. **Stage 4:** a layer manager panel, and EasyEDA-style routing keys: `Alt+W`, `L` for the corner, `Alt+V` for a via, `Shift+W` to stretch, plus the routing width.

## 6. What copperflow keeps that EasyEDA does not have

- The circuit is code, so an agent can edit it over MCP and every change is history with undo.
- Locks and notes for the agent.
- Schematic and PCB are one model, so there is no "update PCB" step and nothing to keep in step by hand.
- Library parts carry a human verification stamp, and the BOM shows it.
