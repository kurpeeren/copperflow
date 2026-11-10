# Studio UX round 11: what is under the pointer

Asked by the maintainer (2026-11-10): "when I come near a footprint, it could show the joint's name" — EasyEDA Pro shows a small label next to the pointer when it rests on a pad (pad number, pin name, net) and on a schematic pin (pin name, net). copperflow shows nothing until a click, and the Properties panel is far from the pointer.

## Global constraints

The round 1–10 constraints hold (English; one-line commits without trailers; no new dependencies; no EasyEDA artwork; small tested modules with the pure logic testable without a DOM; typecheck, test and build pass; files written as LF). The chrome's colours go through theme.css tokens (both themes); the canvases keep their palettes.

## Decisions

- **A hover label, not a tooltip.** When the pointer rests over a pad, a pin end, a via or a track for 250 ms, a small label appears 12 px right-below the pointer and follows it while the target stays the same; it disappears when the pointer leaves the target, on any key, on a press, and while a tool is drawing (the status line already says the net while routing). It is a DOM element over the canvas (so the text is crisp and uses the chrome font), styled by tokens: panel background, hairline border, 11px text, 4px radius, the menu shadow; in the dark theme the same tokens.
- **What it says.** PCB pad: `U1.5 VOUT · V3_3` (designator.pad number, the pin's own name when it has one, the net name or `no net`); a pad of a sub-sheet instance shows the flattened designator and the instance in brackets (`R101.2 · PS1/FB [PS1]`). Via: `via v0003 · GND · top–bottom`. Track: `track t0012 · GND · 0.25 mm · top` (router copper adds `· routed`). Schematic pin end: `U1.VOUT · V3_3`; a net label or power flag: its net; a wire: `wire · V3_3`; a sheet symbol pin: `PS1.VIN · VBUS` (bus pins `· bus D[0:7]`).
- **Picking.** The same pick order and reach as a click would use (pads before parts, pins before symbol bodies, copper by layer visibility), so the label always names what a click would select — one shared pure function (`hoverTarget(world, scene)`) returning the target and its text, tested without a DOM.
- **Off by default?** No: on by default, with View → "Hover labels" as a checked item remembered per browser.

## Task 1: hover labels on both canvases

- `studio/src/pcb/hover-label.ts` (pure: the target under the pointer and its text, for the schematic and the PCB, using the existing pick functions), `studio/src/pcb/HoverLabel.tsx` (the element, placement, the 250 ms delay, the hide rules), wired into both canvases; View → Hover labels toggle (`copperflow.hoverLabels` in localStorage, try/catch); theme tokens for the label in theme.css.
- Tests: the text for each target kind (pad with and without a pin name, instance pad, via, track incl. routed, schematic pin, label, wire, sheet pin, bus pin); the pick agrees with the click pick; the hide rules as pure state transitions (timer, leave, key, press, drawing); the toggle; no raw hex outside the allowed files.

## Task 2: browser check (controller)

On the check copy: rest on U1's pad → the label with pin name and net; on a router track → `· routed`; on a schematic pin; the label hides while routing; the toggle hides it; dark theme readable.
