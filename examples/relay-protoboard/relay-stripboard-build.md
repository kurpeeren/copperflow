# relay-stripboard: stripboard build sheet

Stripboard, 20 columns by 19 rows of 2.54 mm holes, strips along the rows. Rows A–S run from the top, columns 1–20 from the left; the bottom picture is seen from below, so its columns run right to left.

## Parts

| Part | Value | Footprint | Holes (pin) |
| --- | --- | --- | --- |
| D1 | diode | axial4x10.16 | G14 (2), K14 (1) |
| D2 | led | led5mm | K16 (1), L16 (2) |
| J1 | connector | screw2 | C9 (1), E9 (2) |
| J2 | pinheader | pinrow2_p2.54mm | Q13 (1), R13 (2) |
| J3 | connector | screw2 | C4 (1), E4 (2) |
| Q1 | transistor | to92 | J11 (3), K11 (2), L11 (1) |
| R1 | 4.7k | axial6.3x10.16 | L18 (1), P18 (2) |
| R2 | 10k | axial6.3x10.16 | M11 (1), Q11 (2) |
| R3 | 10k | axial6.3x10.16 | E17 (1), I17 (2) |

## Cuts (bottom, 7)

| Cut | Where |
| --- | --- |
| X1 | at E6: drill the hole's copper away |
| X2 | at E11: drill the hole's copper away |
| X3 | between K11 and K12: cut across with a knife |
| X4 | between K14 and K15: cut across with a knife |
| X5 | at L12: drill the hole's copper away |
| X6 | between L16 and L17: cut across with a knife |
| X7 | between Q12 and Q13: cut across with a knife |

## Links (top, 12)

| Link | Net | From | To | Length |
| --- | --- | --- | --- | --- |
| W1 | LEDA | K15 | I15 | 5.1 mm |
| W2 | CTRL | Q17 | L17 | 12.7 mm |
| W3 | BASE | K10 | M10 | 5.1 mm |
| W4 | BASE | M13 | P13 | 7.6 mm |
| W5 | GND | E8 | L8 | 17.8 mm |
| W6 | GND | L9 | Q9 | 12.7 mm |
| W7 | GND | Q12 | R12 | 2.5 mm |
| W8 | V24 | G16 | E16 | 5.1 mm |
| W9 | V24 | E14 | C14 | 5.1 mm |
| W10 | DRV | K12 | J12 | 2.5 mm |
| W11 | DRV | K13 | L13 | 2.5 mm |
| W12 | DRV | J5 | E5 | 12.7 mm |

## What each strip carries

- Strip C: 1–20 V24
- Strip E: 1–5 DRV · 7–10 GND · 12–20 V24
- Strip G: 1–20 V24
- Strip I: 1–20 LEDA
- Strip J: 1–20 DRV
- Strip K: 1–11 BASE · 12–14 DRV · 15–20 LEDA
- Strip L: 1–11 GND · 13–16 DRV · 17–20 CTRL
- Strip M: 1–20 BASE
- Strip P: 1–20 BASE
- Strip Q: 1–12 GND · 13–20 CTRL
- Strip R: 1–20 GND

## Build order

1. Cut the strips from the cut list on the bottom, then check with a meter that no cut strip still joins.
2. Fit the links from the link list on the top, flat on the board, and solder them.
3. Fit the parts lowest first (resistors and diodes, then sockets and headers, then the rest) and solder their legs.
4. Check each net with a meter against the parts list before powering it.
