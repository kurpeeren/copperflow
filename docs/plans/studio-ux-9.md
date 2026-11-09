# Studio UX round 9: a look of our own

Asked by the maintainer (2026-11-09): the Studio still looks blurry and dated; it should look modern, and it may have its own identity rather than EasyEDA's colours. Round 7 fixed the canvases (device-pixel hairlines, a Segoe UI stack). What remains is the chrome: EasyEDA's `#1890ff` blue, 1px grey borders everywhere, SVG icons with 1px strokes that blur at Windows 110% scale, flat grey tabs, and small 12px text with little hierarchy.

The frame stays EasyEDA Pro's (`docs/studio-easyeda-parity.md` §1: the sizes, strips, tabs and panels, the mouse and keys). What changes is how it looks.

## Direction (decided)

- **Identity: copper.** One accent, a warm copper `#C8702A` (hover `#B0601F`, wash `#F7EAD9`, text on copper white), used for the selected tab underline, the pressed tool, focus rings, the primary button, links and the active row. Nothing else is coloured in the chrome; the canvases keep their own palettes.
- **Neutrals, cool and quiet.** Panel `#FFFFFF`, app background and strips `#F5F6F8`, hairlines `#E3E5E8` (hover `#CFD3D8`), text `#1F2328`, muted `#656D76`, disabled `#9AA1A9`. Dark mode is out of scope.
- **Type.** The round 7 stack. Base 13px/20px for panel text and fields, 12px for strip tabs, status and table cells, 11px only in the status line; panel section headers 12px, weight 600, letter-spacing 0, sentence case (no all caps). Tabular figures stay.
- **Hairlines that are one device pixel.** Borders drawn as 1 device pixel at any display scale: a shared CSS rule (`.hairline`/`::before` with `transform: scaleY(1 / dpr)` from a `--dpr` custom property set by the app from `devicePixelRatio`, updated on zoom), used for panel edges, tab strips, table rows and the toolbar separators. No box-shadows as borders.
- **Icons.** A new 16px icon set of our own, drawn on an even grid with 1.5px strokes and round caps (reads sharp at 100%, 110%, 125%, 150%), `shape-rendering: geometricPrecision`, currentColor; the same glyph family for the toolbar, the menus and the Properties buttons. No EasyEDA artwork, no third-party icon packs.
- **Surfaces.** No gradients, no drop shadows except the menu dropdowns and dialogs (one soft shadow `0 4px 16px rgba(31,35,40,.12)`), 4px radius on fields and buttons, 0 on tabs and panels. Tabs: the active tab is white with a 2px copper underline, inactive tabs on the strip colour; the vertical strips' labels stay as they are.
- **Spacing.** An 8px rhythm inside panels (sections 12px apart, rows 28px tall), fields 24px tall as today, toolbar buttons 24×24 in 32px rows.
- **Motion.** Only on things the user did: a 120ms colour transition on hover/pressed, nothing on load.

## Global constraints

The round 1–8 constraints hold (English; one-line commits; no new dependencies; no EasyEDA artwork; no "tscircuit" on screen; small tested modules; typecheck, test and build pass). `styles.css` must not grow: the chrome's tokens move to a new `studio/src/shell/theme.css` loaded after it, and rules that only set colours or borders are replaced in place. Canvas palettes (`schematicTheme`, `PALETTE`) are untouched.

## Task 1: tokens, hairlines and type

- `theme.css` with the tokens above as custom properties; every chrome colour in the CSS files goes through a token (a test greps the CSS for raw hex outside theme.css and the canvas modules).
- The `--dpr` property and the hairline rule; panel edges, strips, tabs, toolbar separators, table rows and Properties section borders use it.
- Type sizes and weights as decided; section headers in sentence case.
- Tests: the token values; no raw hex outside the allowed files; the hairline rule present; the dpr property wired (a pure function that maps devicePixelRatio to the style string).

## Task 2: icons

- `studio/src/icons.tsx` redrawn: every icon on the 16px grid, 1.5px strokes, round caps and joins, `currentColor`; the list of icons in use stays the same (a test checks every name the toolbar, menus and inspector reference exists).
- Toolbar buttons 24×24 with the icon centred; pressed state is the copper wash with a copper icon; disabled is `--disabled`.
- Tests: every icon's viewBox is `0 0 16 16` and its stroke width 1.5 (parse the rendered SVG strings).

## Task 3: browser check (controller)

On the 110% screen: sample a panel edge and a tab strip edge (one device pixel), the active tab underline, a toolbar icon's stroke (no half-tone row wider than 2 device pixels), read the computed fonts of a section header, a field and the status line; check 100% and 125% too. Fix what fails before the round ends.
