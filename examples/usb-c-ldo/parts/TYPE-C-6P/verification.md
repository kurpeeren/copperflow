# Verification of USB Type-C receptacle, 6 pins, power only

Status: not verified
Content: 74100c6e09b6 (changes when part.yaml or footprint.yaml changes)

Check each item against the datasheet and write the page next to it. When everything is
checked, run in a terminal: copperflow parts verify TYPE-C-6P --by "<your name>" --against "<datasheet, revision, page>"

- [ ] Pin 1 is GND2 (ground)
- [ ] Pin 2 is VBUS2 (power out)
- [ ] Pin 3 is CC1 (passive)
- [ ] Pin 4 is CC2 (passive)
- [ ] Pin 5 is VBUS1 (power out)
- [ ] Pin 6 is GND1 (ground)
- [ ] Pin 7 is EH (ground)
- [ ] Footprint footprint.yaml matches the package drawing
- [ ] Every pad in footprint.yaml matches the recommended land pattern (position, size, drill)
- [ ] jlcpcb part C456012 is this exact part

## Drawing

SHOU HAN (Shenzhen Shouhan Technology Co., Ltd.) drawing "TYPE-C 6P", DWG NO. 1006-FGBXXX,
REV. 1, dated 2021.8.2, sheet 1/1. It is page 1 of the PDF that LCSC and JLCPCB link for C456012:
https://datasheet.lcsc.com/datasheet/pdf/68548ae186bce8dcee36d39654e737cb.pdf?productCode=C456012
Pages 2 to 6 of that PDF are the specification for approval (ratings and tests). The pads come from
"RECOMMENDED P.C.B. LAYOUT" (tolerance unspecified ±0.05 mm), the pin names from the pin table on
the same page.

## Pins

The drawing names the contacts (A5, B5 and so on) and gives no pin numbers. Pins 1 to 6 are the
signal pads from left to right as the land pattern draws them: top view, mating face down. The
order matches the drawing's front view of the mating face.

| Pin | Drawing contact | Drawing signal | Name | Type |
|---|---|---|---|---|
| 1 | B12 | GND | GND2 | ground |
| 2 | B9 | VBUS | VBUS2 | power out |
| 3 | A5 | CC1 | CC1 | passive |
| 4 | B5 | CC2 | CC2 | passive |
| 5 | A9 | VBUS | VBUS1 | power out |
| 6 | A12 | GND | GND1 | ground |
| 7 | shell, four legs | (none) | EH | ground |

## Pads

In mm, top view, y up, origin at the body centre (8.94 x 6.80 body in the top view), mating face
at y = -3.40.

| Pad | Contact | Shape | x | y | Width | Height | Drill |
|---|---|---|---|---|---|---|---|
| 1 | B12 | rect, top | -2.70 | 3.05 | 0.80 | 1.00 | |
| 2 | B9 | rect, top | -1.50 | 3.05 | 0.80 | 1.00 | |
| 3 | A5 | rect, top | -0.50 | 3.05 | 0.70 | 1.00 | |
| 4 | B5 | rect, top | 0.50 | 3.05 | 0.70 | 1.00 | |
| 5 | A9 | rect, top | 1.50 | 3.05 | 0.80 | 1.00 | |
| 6 | A12 | rect, top | 2.70 | 3.05 | 0.80 | 1.00 | |
| 7 | shell | oval, plated | -4.32 | 3.00 | 1.00 | 1.80 | slot 0.60 x 1.40 |
| 7 | shell | oval, plated | 4.32 | 3.00 | 1.00 | 1.80 | slot 0.60 x 1.40 |
| 7 | shell | oval, plated | -4.32 | -0.80 | 1.00 | 1.80 | slot 0.60 x 1.40 |
| 7 | shell | oval, plated | 4.32 | -0.80 | 1.00 | 1.80 | slot 0.60 x 1.40 |

How each number follows from the drawing:

- Signal pad centres: 5.40 apart (B12 to A12), 3.00 apart (B9 to A9), 1.00 apart (A5 to B5),
  centred on the connector.
- Signal pad widths: 0.80 is dimensioned on B12 and 0.70 on B5. B9, A9 and A12 are drawn 0.80
  wide and A5 0.70 wide (measured on the drawing; not dimensioned).
- Signal pad height 1.00. The pad's edge toward the mating face is 0.45 from the rear slot
  centres, so the pad centre is 0.05 behind them: y = 3.00 + 0.05.
- Slots, all four ("X4"): copper 1.00 x 1.80, plated slot 0.60 x 1.40. Centres 8.64 apart across
  and 3.80 apart front to back. The front pair is 2.60 from the product edge, which the side view
  shows is the body's front (mating) face, so the front pair is at y = -3.40 + 2.60 = -0.80 and
  the rear pair at -0.80 + 3.80 = 3.00.
- Body outline 8.94 x 6.80 from the top view. The courtyard is the pads and the body plus 0.25 mm
  (the margin copperflow uses when a footprint file draws none); the drawing gives no courtyard.
